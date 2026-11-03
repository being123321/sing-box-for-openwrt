"""Supervise core workers; three failed automatic recoveries trip a manual-reset latch."""
import json,os,pathlib,signal,subprocess as sp,sys,time,secrets
from contextlib import contextmanager
try:import fcntl
except ImportError:fcntl=None
ROOT=pathlib.Path('/etc/sb-router')
ROLES={'backend':'active.json','tun':'tun.json'}

def load(root,role):
    try:data=json.loads((root/('runtime-'+role+'.json')).read_text())
    except (OSError,ValueError):data={}
    return data if isinstance(data,dict) else {}
def store(root,role,state):
    p=root/('runtime-'+role+'.json.tmp');p.write_text(json.dumps(state,ensure_ascii=False));os.chmod(p,0o600);p.replace(root/('runtime-'+role+'.json'))
def event(state,kind,**values):
    state.update(values);state['updatedAt']=int(time.time());history=state.setdefault('events',[]);history.append(dict(time=int(time.time()),kind=kind,**values));state['events']=history[-20:]
@contextmanager
def locked(root,role):
    with (root/('runtime-'+role+'.lock')).open('a') as handle:
        if fcntl:fcntl.flock(handle,fcntl.LOCK_EX)
        try:yield
        finally:
            if fcntl:fcntl.flock(handle,fcntl.LOCK_UN)
def reset(root,role):
    with locked(root,role):
        state=load(root,role);state.update(locked=False,attempt=0,phase='requested',stable=False,pid=0,generation=secrets.token_hex(8));state['manualStarts']=state.get('manualStarts',0)+1
        event(state,'requested',reason='主动或系统启动/重启，不计异常');store(root,role,state)
def recent_recovery(root=ROOT):
    return any(s.get('phase') in ('starting','recovering') and not s.get('locked') and time.time()-s.get('attemptAt',0)<15 for s in [load(root,r) for r in ROLES])
def locked_roles(root=ROOT):return [r for r in ROLES if load(root,r).get('locked')]
def boot_allowed(root,role):return not load(root,role).get('locked') and (role!='tun' or not load(root,'backend').get('locked'))
def snapshot(root=ROOT):
    result=dict(roles={r:load(root,r) for r in ROLES},stableSeconds=60,maxRetries=3)
    try:
        fallback=json.loads((root/'network-fallback.json').read_text())
        if fallback.get('time',0)>=max((s.get('lastLockedAt',0) for s in result['roles'].values()),default=0):result['networkFallback']=fallback
    except (OSError,ValueError):pass
    return result

def health(role):
    if role=='tun':return pathlib.Path('/sys/class/net/sb-zh').exists()
    try:
        import urllib.request
        from router_platform import api_url,api_secret
        req=urllib.request.Request(api_url('/version'),headers={'Authorization':'Bearer '+api_secret()})
        with urllib.request.urlopen(req,timeout=1) as result:return result.status==200
    except Exception:return False

def recover_network(role):
    # Detached: emergency restoration may stop the TUN supervisor itself.
    sp.Popen([str(ROOT/'dns-hook'),'emergency',role],stdin=sp.DEVNULL,stdout=sp.DEVNULL,stderr=sp.DEVNULL,start_new_session=True)

class Supervisor:
    def __init__(self,root,role,command=None,stable_seconds=60,startup_timeout=10,retry_delay=2,health_check=None,on_locked=None,prepare_retry=None):
        self.root=root;self.role=role;self.command=command or [str(root/'core'),'run','-D',str(root),'-c',str(root/ROLES[role])]
        self.stable_seconds=stable_seconds;self.startup_timeout=startup_timeout;self.retry_delay=retry_delay
        self.check=health_check or (lambda:health(role));self.on_locked=on_locked or (lambda:recover_network(role));self.prepare_retry=prepare_retry
        self.stopping=False;self.child=None;self.state=load(root,role)
    def save(self):
        with locked(self.root,self.role):
            if load(self.root,self.role).get('generation')!=self.state.get('generation'):
                self.stopping=True;return
            store(self.root,self.role,self.state)
    def stop(self,*unused):
        self.stopping=True
        if self.child and self.child.poll() is None:
            try:os.killpg(self.child.pid,signal.SIGTERM)
            except ProcessLookupError:pass
    def delay(self,seconds):
        until=time.monotonic()+seconds
        while not self.stopping and time.monotonic()<until:time.sleep(min(.1,max(.001,until-time.monotonic())))
    def terminate(self):
        if self.child and self.child.poll() is None:
            try:os.killpg(self.child.pid,signal.SIGTERM);self.child.wait(timeout=3)
            except (ProcessLookupError,sp.TimeoutExpired):
                try:os.killpg(self.child.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                self.child.wait()
    def run(self):
        if self.state.get('locked'):return 1
        attempt=0;recovering=False
        try:
            while not self.stopping:
                if recovering:
                    if attempt>=3:
                        event(self.state,'locked',phase='locked',locked=True,pid=0,attempt=3,lastLockedAt=int(time.time()),reason='连续 3 次自动恢复未稳定成功，已停止重试')
                        self.save();self.on_locked();return 1
                    self.delay(self.retry_delay)
                    if self.stopping:break
                    if self.prepare_retry and not self.prepare_retry():continue
                    attempt+=1;self.state['autoRestarts']=self.state.get('autoRestarts',0)+1
                    event(self.state,'auto-restart',attempt=attempt,lastRestartAt=int(time.time()),reason='意外退出后自动恢复')
                self.state.update(phase='recovering' if recovering else 'starting',attempt=attempt,attemptAt=int(time.time()),stable=False,locked=False)
                self.save()
                if self.stopping:break
                started=time.monotonic();ready=False;reason='进程意外退出'
                try:
                    self.child=sp.Popen(self.command,start_new_session=True)
                    self.state.update(pid=self.child.pid,startedAt=int(time.time()));self.save()
                    while not self.stopping:
                        code=self.child.poll()
                        if code is not None:break
                        age=time.monotonic()-started
                        if not ready:
                            ready=self.check()
                            if ready:
                                self.state['phase']='recovering' if recovering else 'running';self.save()
                            elif age>=self.startup_timeout:
                                reason='启动健康检查超时';self.terminate();code=self.child.returncode;break
                        if ready and age>=self.stable_seconds and not self.state.get('stable'):
                            recovering=False;attempt=0;event(self.state,'stable',phase='running',attempt=0,stable=True,stableAt=int(time.time()),reason='已稳定运行，恢复计数清零');self.save()
                        self.delay(.15)
                    if self.stopping:break
                    self.state['unexpectedExits']=self.state.get('unexpectedExits',0)+1
                    event(self.state,'unexpected-exit',phase='recovering',pid=0,lastExitAt=int(time.time()),lastExitCode=code,reason=reason);self.save();recovering=True
                except OSError as error:
                    if self.stopping:break
                    self.state['unexpectedExits']=self.state.get('unexpectedExits',0)+1
                    event(self.state,'unexpected-exit',phase='recovering',pid=0,lastExitAt=int(time.time()),lastExitCode=-1,reason='进程无法启动：'+str(error));self.save();recovering=True
            return 0
        finally:
            self.terminate()
            if self.stopping:
                event(self.state,'stopped',phase='stopped',pid=0,reason='正常停止，不计异常');self.save()

def prepare_tun():
    try:r=sp.run([str(ROOT/'dns-hook'),'retry-cleanup'],stdout=sp.DEVNULL,stderr=sp.DEVNULL,timeout=5)
    except (OSError,sp.TimeoutExpired):return True
    return r.returncode!=75

if __name__=='__main__':
    operation,role=sys.argv[1:3]
    if role not in ROLES:raise SystemExit('unknown worker')
    if operation=='allow-boot':raise SystemExit(0 if boot_allowed(ROOT,role) else 1)
    if operation=='reset':reset(ROOT,role)
    elif operation=='run':
        supervisor=Supervisor(ROOT,role,prepare_retry=prepare_tun if role=='tun' else None)
        signal.signal(signal.SIGTERM,supervisor.stop);signal.signal(signal.SIGINT,supervisor.stop)
        raise SystemExit(supervisor.run())
