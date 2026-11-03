"""Per-configuration panel API settings, independent of global panel bookmarks."""
import json,os,secrets
from contextlib import contextmanager
try:import fcntl
except ImportError:fcntl=None

RESERVED={9091,9092,9093,9094,9095,15353,18081,18082}
def read(root):
    try:
        data=json.loads((root/'profile-api.json').read_text())
        return data if isinstance(data,dict) else {}
    except (OSError,ValueError):return {}
def write(root,data):
    p=root/'profile-api.json.tmp';p.write_text(json.dumps(data,ensure_ascii=False));os.chmod(p,0o600);p.replace(root/'profile-api.json')
def port(value):
    try:result=int(value)
    except (TypeError,ValueError):raise ValueError('请输入有效端口')
    if result<1024 or result>65535 or result in RESERVED:raise ValueError('端口需在 1024–65535 之间，且不能占用官方面板等内部服务端口')
    return result
@contextmanager
def locked(root):
    with (root/'profile-api.lock').open('a') as handle:
        if fcntl:fcntl.flock(handle,fcntl.LOCK_EX)
        try:yield
        finally:
            if fcntl:fcntl.flock(handle,fcntl.LOCK_UN)

def settings(root,name,cfg,lan):
    with locked(root):
        data=read(root);item=data.setdefault(name,{})
        if not item.get('defaultSecret'):
            # Preserve an existing live connection during this feature's first migration.
            selected=(root/'selected').read_text().strip() if (root/'selected').exists() else ''
            old=(root/'token').read_text().strip() if name==selected and (root/'token').exists() else ''
            item['defaultSecret']=old or secrets.token_urlsafe(32);write(root,data)
    source=cfg.get('experimental',{}).get('clash_api') or {}
    controller=source.get('external_controller') or ''
    try:source_port=port(controller.rsplit(':',1)[1]) if controller else 9090
    except (IndexError,ValueError):source_port=9090
    defaults=dict(port=source_port,secret=source.get('secret') or item['defaultSecret'])
    effective=dict(defaults,**item.get('override',{}))
    effective.update(name=name,address=lan,nativePort=9091,defaults=defaults,overridden=bool(item.get('override')))
    return effective
def change(root,name,cfg,lan,arg):
    settings(root,name,cfg,lan)
    reset=bool(arg.get('reset'))
    if not reset:
        secret=str(arg.get('secret') or '').strip()
        if not secret or len(secret)>256 or any(ord(c)<32 or ord(c)>126 for c in secret):raise ValueError('密钥应为 1–256 个可见英文字符')
        override=dict(port=port(arg.get('port')),secret=secret)
    with locked(root):
        data=read(root)
        if reset:data[name].pop('override',None)
        else:data[name]['override']=override
        write(root,data)
    return settings(root,name,cfg,lan)
def patch(cfg,prefs,lan,root):
    ex=cfg.setdefault('experimental',{})
    origins=['http://'+lan+':'+str(p) for p in sorted({prefs['port'],9091,9092,9093,9094,9095})]
    ex['clash_api']=dict(ex.get('clash_api') or {},external_controller=lan+':'+str(prefs['port']),secret=prefs['secret'],external_ui=str(root/'ui'),access_control_allow_origin=origins)
    cfg['services']=[s for s in cfg.get('services',[]) if s.get('tag') not in ('router-dashboard','router-overview')]
    for tag,listen_port in [('router-dashboard',9091),('router-overview',9095)]:
        cfg['services'].append(dict(type='api',tag=tag,listen=lan,listen_port=listen_port,secret=prefs['secret'],access_control_allow_origin=origins,dashboard=str(root/'ui')))
    return cfg
