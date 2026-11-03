"""Server-side inbounds, kept independent from the selected client subscription."""
import copy,hashlib,json,os,pathlib,secrets,subprocess
ROOT=pathlib.Path('/etc/sb-router')
TYPES={'hysteria2','vless','vmess','trojan','shadowsocks','tuic','anytls','socks','http','mixed','naive','hysteria','shadowtls','snell'}
RESERVED_PORTS={15353,18081,18082,9090,9091,9092,9093,9094}
DIRECT_TAG='sb-router-server-direct'

def legacy_config():
    for path in (ROOT/'before-cutover/original-sing-box.json',ROOT/'ingress-extra.json'):
        if path.exists():return json.loads(path.read_bytes())
    return {'inbounds':[dict(type='http',tag='local-http',listen='127.0.0.1',listen_port=18081)],
            'outbounds':[dict(type='direct',tag='ingress-direct')],'route':{'final':'ingress-direct'},
            'dns':{'servers':[dict(type='udp',tag='bootstrap-local',server='223.5.5.5')]}}

def snapshot():
    path=ROOT/'servers.json'
    raw=path.read_bytes() if path.exists() else b'{"items":{},"deleted":[]}'
    value=json.loads(raw)
    return value,hashlib.sha256(raw).hexdigest()

def entries(baseline=None,state=None):
    baseline=legacy_config() if baseline is None else baseline
    state=snapshot()[0] if state is None else state
    rows=[];seen=set()
    for cfg in baseline.get('inbounds',[]):
        tag=cfg['tag'];seen.add(tag)
        if tag in state.get('deleted',[]):continue
        item=state.get('items',{}).get(tag,{})
        rows.append(dict(id=tag,config=copy.deepcopy(item.get('config',cfg)),
                         enabled=item.get('enabled',True),route=item.get('route','follow'),
                         source='已有服务',protected=cfg.get('listen_port') in RESERVED_PORTS,firewall=item.get('firewall',False)))
    for tag,item in state.get('items',{}).items():
        if tag not in seen and tag not in state.get('deleted',[]):
            rows.append(dict(id=tag,config=copy.deepcopy(item['config']),enabled=item['enabled'],
                             route=item.get('route','direct'),source='本菜单添加',protected=False,firewall=item.get('firewall',True)))
    return rows

def configure(cfg,baseline=None,previous_tags=()):
    baseline=legacy_config() if baseline is None else baseline
    state=snapshot()[0];rows=entries(baseline,state)
    owned={x['tag'] for x in baseline.get('inbounds',[])}|set(state.get('items',{}))|set(state.get('deleted',[]))|set(previous_tags)
    cfg['inbounds']=[x for x in cfg.get('inbounds',[]) if x.get('tag') not in owned]
    for row in rows:
        if not row['enabled']:continue
        inbound=copy.deepcopy(row['config'])
        tls=inbound.get('tls',{})
        if 'acme' in tls:tls['certificate_provider']={'type':'acme',**tls.pop('acme')}
        cfg['inbounds'].append(inbound)
    rules=cfg.setdefault('route',{}).setdefault('rules',[])
    cfg['route']['rules']=[r for r in rules if r.get('outbound')!=DIRECT_TAG]
    direct=[r['id'] for r in rows if r['enabled'] and r['route']=='direct']
    if direct:
        existing=next((x for x in cfg['outbounds'] if x.get('tag')==DIRECT_TAG),None)
        if existing and existing.get('type')!='direct':raise ValueError('服务器直连出站标识冲突')
        if not existing:cfg['outbounds'].append({'type':'direct','tag':DIRECT_TAG})
        cfg['route']['rules'].insert(0,{'inbound':direct,'action':'route','outbound':DIRECT_TAG})
    else:
        cfg['outbounds']=[x for x in cfg.get('outbounds',[]) if x.get('tag')!=DIRECT_TAG]
    return cfg

def listening_ports(pid):
    if not pid:return set()
    inodes=set()
    for fd in pathlib.Path('/proc',str(pid),'fd').glob('*'):
        try:
            target=os.readlink(fd)
            if target.startswith('socket:['):inodes.add(target[8:-1])
        except OSError:pass
    ports=set()
    for proto in ('tcp','tcp6','udp','udp6'):
        try:lines=pathlib.Path('/proc',str(pid),'net',proto).read_text().splitlines()[1:]
        except OSError:continue
        for line in lines:
            fields=line.split()
            if fields[9] in inodes and (proto.startswith('udp') or fields[3]=='0A'):
                ports.add(int(fields[1].rsplit(':',1)[1],16))
    return ports

def status(pid):
    _,revision=snapshot()
    live=json.loads((ROOT/'active.json').read_bytes()) if (ROOT/'active.json').exists() else {}
    active={x['tag']:x for x in live.get('inbounds',[])}
    ports=listening_ports(pid)
    rows=[]
    for row in entries():
        c=row['config'];current=active.get(row['id'],{})
        rows.append({k:row[k] for k in ('id','enabled','source','protected','route','firewall')}|{
            'type':c['type'],'listen':c.get('listen','::'),'port':c.get('listen_port'),
            'tls':bool(c.get('tls',{}).get('enabled')),
            'running':bool(pid and current.get('listen_port')==c.get('listen_port') and c.get('listen_port') in ports)})
    return {'servers':rows,'revision':revision,'backendRunning':bool(pid)}

def get(tag):
    row=next((x for x in entries() if x['id']==tag),None)
    if row is None:raise ValueError('服务端不存在，请刷新')
    return dict(value=json.dumps(row['config'],ensure_ascii=False,indent=2),enabled=row['enabled'],
                route=row['route'],protected=row['protected'],firewall=row['firewall'],revision=snapshot()[1])

def proposed(arg,delete=False):
    state,revision=snapshot()
    if arg.get('revision')!=revision:raise ValueError('服务器配置已改变，请重新打开编辑窗口')
    tag=arg.get('id','');original=next((r for r in entries() if r['id']==tag),None)
    if original and original['protected']:raise ValueError('这是系统保留接口，不能从服务器菜单修改')
    if delete:
        if not original:raise ValueError('服务端不存在')
        state.setdefault('items',{}).pop(tag,None)
        state.setdefault('deleted',[]).append(tag)
        return state
    cfg=json.loads(arg['value'])
    if not isinstance(cfg,dict) or cfg.get('type') not in TYPES:raise ValueError('不支持的服务端协议')
    name=cfg.get('tag')
    if not isinstance(name,str) or not name.strip() or len(name)>128 or any(ord(c)<32 for c in name):
        raise ValueError('名称不能为空，最多 128 字符')
    if tag and name!=tag:raise ValueError('已有服务的标识不可更改，以免破坏路由引用')
    if not tag and any(r['id']==name for r in entries()):raise ValueError('服务端名称已存在')
    port=cfg.get('listen_port')
    if type(port) is not int or not 1<=port<=65535:raise ValueError('端口必须为 1–65535')
    if port in RESERVED_PORTS:raise ValueError('端口被本项目的管理或内部接口保留')
    if cfg.get('type') in ('socks','http','mixed') and not cfg.get('users') and cfg.get('listen') not in ('127.0.0.1','::1'):
        raise ValueError('非本机监听的 SOCKS / HTTP 服务必须设置账号密码')
    route=arg.get('route','direct')
    if route not in ('direct','follow'):raise ValueError('出站策略无效')
    state.setdefault('items',{})[name]={'config':cfg,'enabled':bool(arg.get('enabled',True)),'route':route,'firewall':bool(arg.get('firewall',True))}
    state['deleted']=[x for x in state.get('deleted',[]) if x!=name]
    return state

def generate(kind):
    if kind=='password':return {'password':secrets.token_urlsafe(24)}
    commands={'uuid':['uuid'],'reality':['reality-keypair']}
    if kind not in commands:raise ValueError('未知生成类型')
    result=subprocess.run([str(ROOT/'core'),'generate',*commands[kind]],capture_output=True,text=True,check=True,timeout=10)
    if kind=='uuid':return {'uuid':result.stdout.strip()}
    values={}
    for line in result.stdout.splitlines():
        key,_,value=line.partition(':')
        if 'Private' in key:values['private_key']=value.strip()
        elif 'Public' in key:values['public_key']=value.strip()
    if 'private_key' not in values:raise ValueError('内核未返回 Reality 密钥')
    values['short_id']=secrets.token_hex(8)
    return values
