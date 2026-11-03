"""Five-minute local quota extraction. Never downloads a remote subscription."""
import json,os,pathlib,time,subprocess,urllib.request
import subscription_usage as usage
ROOT=pathlib.Path('/etc/sb-router')
INTERVAL=300

def sources(root=ROOT):
    for path in sorted((root/'profiles').glob('*.json')):
        try:obj=json.loads(path.read_text())
        except (OSError,ValueError):continue
        if obj.get('base'):
            for sub in obj.get('subs',[]):
                yield dict(id='base:'+sub['name'],name=sub['name'],identifier=sub['url'],value={'nodes':sub.get('nodes',[])},profile='base')
        else:
            yield dict(id='profile:'+path.stem,name=path.stem,identifier=obj.get('url') or obj.get('suburl') or 'profile:'+path.stem,value=obj.get('config') or {'nodes':obj.get('nodes',[])},profile=path.stem)

def status(root=ROOT):
    try:stamp=json.loads((root/'usage-extraction.json').read_text()).get('time')
    except (OSError,ValueError):stamp=None
    return dict(time=stamp,interval=INTERVAL,items=[dict(id=s['id'],name=s['name'],usage=usage.info(root,s['identifier'])) for s in sources(root)])

def runtime_groups():
    from router_platform import api_url,api_secret
    request=urllib.request.Request(api_url('/proxies'),headers={'Authorization':'Bearer '+api_secret()})
    with urllib.request.urlopen(request,timeout=3) as response:return json.load(response)

def refresh(root=ROOT,force=False,running=None,read_runtime=None,now=None):
    running=pathlib.Path('/sys/class/net/sb-zh').exists() if running is None else running
    old=status(root);now=int(time.time()) if now is None else now
    if not running:return dict(old,skipped=True,reason='未运行，保留最后一次显示')
    if not force and old['time'] and now-old['time']<INTERVAL:return dict(old,skipped=True)
    try:active=(root/'selected').read_text().strip()
    except OSError:active=''
    try:live=(read_runtime or runtime_groups)()
    except Exception:live={}
    for source in sources(root):
        values=[source['value']]
        if source['profile']!='base' and source['profile']==active:values.append(live)
        usage.record_groups(root,source['identifier'],values)
    p=root/'usage-extraction.json.tmp';p.write_text(json.dumps({'time':now}));os.chmod(p,0o600);p.replace(root/'usage-extraction.json')
    return dict(status(root),skipped=False)

def ensure_cron():
    result=subprocess.run(['crontab','-l'],capture_output=True,text=True)
    lines=[line for line in result.stdout.splitlines() if '# sb-router-usage' not in line]
    lines.append('*/5 * * * * /etc/sb-router/manage cli refresh-usage >/tmp/sb-usage-refresh.log 2>&1 # sb-router-usage')
    subprocess.run(['crontab','-'],input=('\n'.join(lines)+'\n').encode(),check=True)
    return {'ok':True}
