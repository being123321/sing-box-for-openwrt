import hashlib,json,pathlib,subprocess
ROOT=pathlib.Path('/etc/sb-router')
CONFIG=pathlib.Path('/etc/config/firewall')
def uci(*args):
    return subprocess.run(['uci','-q',*args],capture_output=True,text=True)
def desired():
    import server_manager
    rules=[]
    for row in server_manager.entries():
        c=row['config']
        if not row['enabled'] or not row.get('firewall') or c.get('listen') in ('127.0.0.1','::1'):continue
        typ=c['type']
        proto='udp' if typ in ('hysteria2','hysteria','tuic') else 'tcp udp' if typ in ('shadowsocks','socks','mixed') else 'tcp'
        rules.append(('server:'+row['id'],int(c['listen_port']),proto))
    proxy=ROOT/'reverse-proxies.json'
    if proxy.exists():
        for item in json.loads(proxy.read_text()).get('items',[]):
            if item.get('enabled',True) and item.get('firewall',True):rules.append(('proxy:'+item['id'],int(item.get('port',443)),'tcp'))
    return rules
def sync():
    path=ROOT/'firewall-owned.json'
    old=json.loads(path.read_text()) if path.exists() else {}
    wanted={}
    for identity,port,proto in desired():
        key='sbr_'+hashlib.sha256(identity.encode()).hexdigest()[:16]
        wanted[key]={'name':'sing-box '+identity,'src':'wan','dest_port':str(port),'proto':proto,'target':'ACCEPT','enabled':'1'}
    if wanted==old:return {'ok':True,'rules':len(wanted)}
    if uci('changes','firewall').stdout.strip():
        raise ValueError('防火墙有尚未保存的修改，请先保存或撤销这些修改后重试')
    config=CONFIG;backup=config.read_bytes()
    try:
        for key in old:uci('delete','firewall.'+key)
        for key,values in wanted.items():
            uci('set','firewall.'+key+'=rule').check_returncode()
            for field,value in values.items():uci('set','firewall.'+key+'.'+field+'='+value).check_returncode()
        uci('commit','firewall').check_returncode()
        checked=subprocess.run(['fw4','check'],capture_output=True,text=True,timeout=20)
        if checked.returncode:raise ValueError('防火墙配置校验失败')
        subprocess.run(['/etc/init.d/firewall','reload'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30)
        tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(wanted));tmp.chmod(0o600);tmp.replace(path)
    except Exception:
        config.write_bytes(backup);uci('revert','firewall')
        subprocess.run(['/etc/init.d/firewall','reload'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30)
        raise
    return {'ok':True,'rules':len(wanted)}
