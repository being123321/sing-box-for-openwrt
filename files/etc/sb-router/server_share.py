import base64,json,subprocess,urllib.parse,ipaddress,re
import server_manager
from share import qr_svg
def b64(data):
    return base64.urlsafe_b64encode(data).decode().rstrip('=')
def share(arg):
    cfg=json.loads(server_manager.get(arg['id'])['value'])
    host=arg['host'].strip().strip('[]')
    if not host or any(c.isspace() or c in '/?#@' for c in host):raise ValueError('请填写可访问的域名或公网 IP')
    try:host=str(ipaddress.ip_address(host))
    except ValueError:
        host=host.encode('idna').decode()
        if not re.fullmatch(r'[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?',host):
            raise ValueError('请只填写域名或 IP，端口由服务端配置提供')
    address='['+host+']' if ':' in host else host
    address+=':'+str(cfg['listen_port'])
    users=cfg.get('users',[])
    index=int(arg.get('user',0))
    if users and not 0<=index<len(users):raise ValueError('用户不存在')
    user=users[index] if users else {}
    tls=cfg.get('tls',{});query={}
    sni=tls.get('server_name') or next(iter(tls.get('certificate_provider',{}).get('domain',[])),host)
    if tls.get('enabled'):
        query.update(security='tls',sni=sni)
        if tls.get('alpn'):query['alpn']=','.join(tls['alpn'])
    reality=tls.get('reality',{})
    if reality.get('enabled'):
        private=base64.urlsafe_b64decode(reality['private_key']+'='*(-len(reality['private_key'])%4))
        der=bytes.fromhex('302e020100300506032b656e04220420')+private
        pub=subprocess.check_output(['openssl','pkey','-inform','DER','-pubout','-outform','DER'],input=der,stderr=subprocess.DEVNULL,timeout=5)[-32:]
        query.update(security='reality',pbk=b64(pub),sid=(reality.get('short_id') or [''])[0],fp='chrome')
    transport=cfg.get('transport',{})
    if transport:
        query['type']=transport['type']
        for key in ('path','service_name'):
            if transport.get(key):query['serviceName' if key=='service_name' else key]=transport[key]
        if transport.get('headers',{}).get('Host'):query['host']=transport['headers']['Host']
    typ=cfg['type'];quote=lambda x:urllib.parse.quote(str(x),safe='')
    if typ=='shadowsocks':
        auth=b64((cfg['method']+':'+cfg['password']).encode());scheme='ss'
    elif typ in ('vless','vmess'):
        auth=quote(user['uuid']);scheme=typ
        if user.get('flow'):query['flow']=user['flow']
        if typ=='vless':query['encryption']='none'
    elif typ=='tuic':auth=quote(user['uuid'])+':'+quote(user['password']);scheme=typ
    elif typ in ('hysteria2','trojan','anytls'):
        auth=quote(user['password']);scheme=typ
        if typ=='hysteria2':
            query.pop('security',None)
            if cfg.get('obfs'):query.update(obfs=cfg['obfs']['type'],**{'obfs-password':cfg['obfs'].get('password','')})
    elif typ in ('socks','http','mixed'):
        auth=quote(user.get('username',''))+':'+quote(user.get('password',''));scheme='socks5' if typ!='http' else 'http'
    else:raise ValueError('该协议暂不支持通用 URI 分享，请使用客户端 JSON')
    if typ=='vmess':
        data={'v':'2','ps':cfg['tag'],'add':host,'port':str(cfg['listen_port']),'id':user['uuid'],'aid':'0',
              'net':transport.get('type','tcp'),'tls':'tls' if tls.get('enabled') else '',
              'sni':sni,'path':transport.get('path',''),'host':transport.get('headers',{}).get('Host','')}
        link='vmess://'+base64.b64encode(json.dumps(data).encode()).decode()
    else:link=scheme+'://'+auth+'@'+address+('?' + urllib.parse.urlencode(query) if query else '')+'#'+quote(cfg['tag'])
    try:qrcode=qr_svg(link)
    except ValueError:qrcode=''
    return {'link':link,'qr':qrcode,'warning':'链接含认证信息，只分享给可信的人。','users':[u.get('name') or u.get('username') or str(i+1) for i,u in enumerate(users)]}
