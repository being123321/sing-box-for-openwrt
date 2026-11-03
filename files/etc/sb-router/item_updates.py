import hashlib,json,pathlib,subprocess
ROOT=pathlib.Path('/etc/sb-router')
CRON=pathlib.Path('/etc/crontabs/root')
DEFAULT={'enabled':False,'mode':'daily','weekday':1,'day':1,'hour':2,'minute':0}

def validate(value):
    p=dict(DEFAULT,**value)
    for k in ('weekday','day','hour','minute'):p[k]=int(p[k])
    p['enabled']=bool(p['enabled'])
    if p['mode'] not in ('daily','weekly','monthly') or not 0<=p['hour']<=23 or not 0<=p['minute']<=59:
        raise ValueError('更新周期或时间无效')
    if not 0<=p['weekday']<=6 or not 1<=p['day']<=31:raise ValueError('更新日期无效')
    return p

def read():
    path=ROOT/'item-updates.json'
    return json.loads(path.read_bytes()) if path.exists() else {}

def get(identity):
    return validate(read().get(identity,{}))

def sync(policies,allowed):
    cron=CRON
    previous=cron.read_bytes() if cron.exists() else b''
    lines=[]
    for line in previous.decode().splitlines():
        words=line.split()
        if '# sb-router-item' in line:continue
        if len(words)>=8 and words[5:7]==['/etc/sb-router/manage','cli'] and words[7] in ('refresh-selected','refresh-nodes','refresh-config','refresh-item'):continue
        lines.append(line)
    for identity in allowed:
        p=validate(policies.get(identity,{}))
        if not p['enabled']:continue
        day=str(p['day']) if p['mode']=='monthly' else '*'
        weekday=str(p['weekday']) if p['mode']=='weekly' else '*'
        token=identity.encode().hex();name=hashlib.sha256(identity.encode()).hexdigest()[:12]
        lines.append(f"{p['minute']} {p['hour']} {day} * {weekday} /etc/sb-router/manage cli refresh-item {token} >/tmp/sb-item-{name}.log 2>&1 # sb-router-item")
    path=ROOT/'item-updates.json';old=path.read_bytes() if path.exists() else None
    tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(policies,ensure_ascii=False));tmp.chmod(0o600);tmp.replace(path)
    try:subprocess.run(['crontab','-'],input=('\n'.join(lines)+'\n').encode(),check=True)
    except Exception:
        if old is None:path.unlink(missing_ok=True)
        else:path.write_bytes(old)
        subprocess.run(['crontab','-'],input=previous)
        raise

def set_policy(identity,value,allowed):
    if identity not in allowed:raise ValueError('该来源没有可更新链接')
    policies=read();policies[identity]=validate(value);sync(policies,allowed)
    return {'ok':True,'policy':policies[identity]}

def migrate(items,legacy):
    if (ROOT/'item-updates.json').exists():return
    chosen=set(legacy['selected']);policies={}
    for item in items:
        p=dict(legacy['schedule'])
        p['enabled']=bool(p['enabled'] and item['id'] in chosen)
        policies[item['id']]=validate(p)
    sync(policies,[x['id'] for x in items])
