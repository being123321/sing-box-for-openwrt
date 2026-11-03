import hashlib,json,pathlib,re,shutil,socket,subprocess,urllib.parse,time
from certificates import domain_name,key_matches
ROOT=pathlib.Path('/etc/sb-router')
PARENT=pathlib.Path('/etc/api-https/frontend.cfg')
BEGIN='# sb-router reverse proxy begin'
END='# sb-router reverse proxy end'
def read():
    path=ROOT/'reverse-proxies.json'
    return json.loads(path.read_text()) if path.exists() else {'items':[]}
def list_items():
    return {'items':read()['items'],'canReuse443':PARENT.exists() and 'frontend api_tls' in PARENT.read_text()}
def clean_parent(text):
    return re.sub(re.escape(BEGIN)+r'.*?'+re.escape(END)+r'\n?','',text,flags=re.S)
def configure(items):
    active=[x for x in items if x.get('enabled',True)]
    parent=PARENT.read_text() if PARENT.exists() else None
    bridge=bool(parent and 'frontend api_tls' in parent and any(x['https'] and x['port']==443 for x in active))
    groups={}
    for x in active:
        key=(x['port'],x['https'])
        groups.setdefault(key,[]).append(x)
    if len({k[0] for k in groups})!=len(groups):raise ValueError('同一个监听端口不能同时用于 HTTP 和 HTTPS')
    lines=['global','    maxconn 1024','defaults','    mode http','    timeout connect 10s','    timeout client 5m','    timeout server 5m','    timeout tunnel 1h']
    for (port,tls),rows in sorted(groups.items()):
        name='listener_'+str(port)
        lines+=['frontend '+name,'    mode http']
        listen='127.0.0.1:10445 accept-proxy' if bridge and port==443 and tls else '[::]:'+str(port)+' v4v6'
        if tls:
            for x in rows:
                if not key_matches(pathlib.Path(x['certificate']),pathlib.Path(x['key'])):raise ValueError('证书与私钥不匹配：'+x['domain'])
                pem=ROOT/('proxy-cert-'+x['id']+'.pem')
                pem.write_bytes(pathlib.Path(x['certificate']).read_bytes()+b'\n'+pathlib.Path(x['key']).read_bytes());pem.chmod(0o600)
            listen+=' ssl '+ ' '.join('crt '+str(ROOT/('proxy-cert-'+x['id']+'.pem')) for x in rows)+' alpn h2,http/1.1'
        lines+=['    bind '+listen,'    option forwardfor','    http-request set-header X-Forwarded-Proto '+('https' if tls else 'http')]
        names=' '.join(x['domain']+' '+x['domain']+':'+str(port) for x in rows)
        lines+=['    http-request deny unless { hdr(host) -i '+names+' }']
        for x in rows:lines+=['    use_backend proxy_'+x['id']+' if { hdr(host) -i '+x['domain']+' '+x['domain']+':'+str(port)+' }']
        for x in rows:
            u=urllib.parse.urlsplit(x['target']);host=u.hostname;up='['+host+']' if ':' in host else host
            up+=':'+str(u.port or (443 if u.scheme=='https' else 80))
            ssl=' ssl verify required ca-file /etc/ssl/certs/ca-certificates.crt sni str('+host+')' if u.scheme=='https' else ''
            lines+=['backend proxy_'+x['id'],'    mode http','    server target '+up+ssl]
    updated=clean_parent(parent) if parent is not None else None
    if updated is not None and bridge:
        domains=' '.join(x['domain'] for x in active if x['https'] and x['port']==443)
        block=BEGIN+'\n    use_backend sbr_reverse_terminate if { req.ssl_sni -i '+domains+' }\n'+END+'\n'
        pos=updated.index('\nbackend ',updated.index('frontend api_tls'))
        updated=updated[:pos]+'\n'+block+updated[pos:]
        updated+='\n'+BEGIN+'\nbackend sbr_reverse_terminate\n    mode tcp\n    server managed 127.0.0.1:10445 send-proxy-v2\n'+END+'\n'
    return '\n'.join(lines)+'\n',updated,active
def reload_current():
    text,parent,active=configure(read()['items'])
    config=ROOT/'reverse-proxy.cfg';old=config.read_bytes() if config.exists() else None
    old_parent=PARENT.read_bytes() if PARENT.exists() else None
    try:
        candidate=config.with_suffix('.candidate');candidate.write_text(text)
        if active:subprocess.run(['haproxy','-c','-q','-f',str(candidate)],check=True,capture_output=True,timeout=15)
        candidate.replace(config)
        if parent is not None and parent.encode()!=old_parent:
            p=PARENT.with_suffix('.sbr-candidate');p.write_text(parent)
            subprocess.run(['haproxy','-c','-q','-f',str(p)],check=True,capture_output=True,timeout=15);p.replace(PARENT)
            subprocess.run(['/etc/init.d/api-gw-https','reload'],check=True,stdout=subprocess.DEVNULL)
        subprocess.run(['/etc/init.d/sb-reverse-proxy','restart' if active else 'stop'],check=True,stdout=subprocess.DEVNULL)
        if active:
            import server_manager
            expected={10445 if x['https'] and x['port']==443 and parent and 'sbr_reverse_terminate' in parent else x['port'] for x in active}
            for _ in range(40):
                ports=set()
                for p in pathlib.Path('/proc').glob('[0-9]*'):
                    try:
                        if str(config).encode() in (p/'cmdline').read_bytes():ports|=server_manager.listening_ports(int(p.name))
                    except OSError:pass
                if expected<=ports:break
                time.sleep(.25)
            else:raise ValueError('监听端口不可用')
    except Exception:
        if old is None:config.unlink(missing_ok=True)
        else:config.write_bytes(old)
        if old_parent is not None:PARENT.write_bytes(old_parent);subprocess.run(['/etc/init.d/api-gw-https','reload'],stdout=subprocess.DEVNULL)
        if old:subprocess.run(['/etc/init.d/sb-reverse-proxy','restart'],stdout=subprocess.DEVNULL)
        raise ValueError('反代配置或端口检查失败，已恢复原配置')
def save(arg,delete=False):
    if not shutil.which('haproxy'):
        subprocess.run(['/bin/sh',str(ROOT/'install-helper.sh'),'--deps-only','--with-reverse-proxy'],check=True,timeout=300,stdout=subprocess.DEVNULL)
    data=read();previous=json.dumps(data).encode()
    identity=arg.get('id','')
    if identity and not any(x['id']==identity for x in data['items']):raise ValueError('反代项目不存在')
    if delete:data['items']=[x for x in data['items'] if x['id']!=identity]
    else:
        domain=domain_name(arg['domain'])
        if domain.startswith('*.'):raise ValueError('请填写单个完整域名')
        if PARENT.exists():
            parent=clean_parent(PARENT.read_text())
            if any(domain in x.split() for x in parent.splitlines() if 'req.ssl_sni -i' in x):
                raise ValueError('该域名已被现有 HTTPS 入口使用，请选择新域名或编辑原服务')
        target=arg['target'].strip()
        if '://' not in target:target='http://'+target
        u=urllib.parse.urlsplit(target)
        if u.scheme not in ('http','https') or not u.hostname or u.username or u.password or u.path not in ('','/') or u.query or u.fragment:
            raise ValueError('目标请填写 http://地址:端口 或 https://地址:端口，不附带路径和账号')
        if not re.fullmatch(r'[a-zA-Z0-9.:-]+',u.hostname):raise ValueError('目标主机名无效')
        port=int(arg.get('port',443))
        if not 1<=port<=65535:raise ValueError('监听端口无效')
        if any(x['domain']==domain and x['id']!=identity for x in data['items']):raise ValueError('域名已存在')
        identity=identity or hashlib.sha256(domain.encode()).hexdigest()[:16]
        row={'id':identity,'domain':domain,'target':target,'port':port,'https':bool(arg.get('https',True)),
             'certificate':arg.get('certificate',''),'key':arg.get('key',''),'enabled':bool(arg.get('enabled',True)),'firewall':bool(arg.get('firewall',True))}
        data['items']=[row if x['id']==identity else x for x in data['items']]
        if not any(x['id']==identity for x in data['items']):data['items'].append(row)
    path=ROOT/'reverse-proxies.json';path.write_text(json.dumps(data));path.chmod(0o600)
    try:
        reload_current()
        import managed_firewall
        managed_firewall.sync()
        subprocess.run(['/etc/init.d/sb-reverse-proxy','enable'],check=True)
    except Exception:
        path.write_bytes(previous);reload_current()
        try:
            import managed_firewall
            managed_firewall.sync()
        except Exception:pass
        raise
    return {'ok':True}
