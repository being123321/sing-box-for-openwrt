#!/usr/bin/python3
import datetime,hashlib,json,os,pathlib,re,subprocess,sys,shutil
ROOT=pathlib.Path('/etc/sb-router')

def ensure():
    if not any(p.exists() and (p.parent/'dnsapi/dns_cf.sh').exists() for p in clients()) or not shutil.which('openssl'):
        subprocess.run(['/bin/sh',str(ROOT/'install-helper.sh'),'--deps-only','--with-certificates'],check=True,timeout=300,stdout=subprocess.DEVNULL)
def clients():
    return [pathlib.Path(p) for p in ('/usr/lib/acme/client/acme.sh','/usr/lib/acme/acme.sh','/usr/bin/acme.sh')]
def client():
    ensure()
    return next(p for p in clients() if p.exists())
def domain_name(value):
    value=value.strip().lower().encode('idna').decode()
    if not re.fullmatch(r'(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}',value):
        raise ValueError('请填写有效域名')
    return value
def key_matches(cert,key):
    try:
        c=subprocess.check_output(['openssl','x509','-in',str(cert),'-pubkey','-noout'],stderr=subprocess.DEVNULL,timeout=5)
        k=subprocess.check_output(['openssl','pkey','-in',str(key),'-pubout'],stderr=subprocess.DEVNULL,timeout=5)
        return c==k
    except (OSError,subprocess.SubprocessError):return False
def scan():
    if not shutil.which('openssl'):ensure()
    candidates=set()
    for root in [str(ROOT/'certificates'),'/etc/home-admin','/etc/api-https','/etc/acme','/etc/sing-box','/etc/ssl/private']:
        p=pathlib.Path(root)
        if p.is_dir():
            for x in p.rglob('*'):
                if x.is_file() and x.suffix in ('.pem','.crt','.cer'):candidates.add(x.resolve())
    for cfg in [ROOT/'active.json',ROOT/'servers.json']:
        if cfg.exists():
            for value in re.findall(r'"certificate_path"\s*:\s*"([^"]+)"',cfg.read_text()):
                p=pathlib.Path(value)
                if p.is_file():candidates.add(p.resolve())
    results=[]
    for cert in sorted(candidates)[:200]:
        r=subprocess.run(['openssl','x509','-in',str(cert),'-noout','-subject','-issuer','-enddate','-ext','subjectAltName'],capture_output=True,text=True,timeout=5)
        if r.returncode:continue
        text=r.stdout
        if not 'DNS:' in text:continue
        domains=re.findall(r'DNS:([^,\s]+)',text)
        key_candidates=[cert,cert.with_suffix('.key'),cert.parent/'private.key',cert.parent/'key.pem',
                        cert.parent/(cert.parent.name.replace('_ecc','')+'.key')]
        key_candidates+=list(cert.parent.glob('*.key'))
        if cert.name in ('chat.pem','tls.pem'):key_candidates += list(cert.parent.glob('*key*'))
        key=next((k for k in dict.fromkeys(key_candidates) if k.is_file() and key_matches(cert,k)),None)
        if not key:continue
        expiry=next((x.partition('=')[2] for x in text.splitlines() if x.startswith('notAfter=')),'')
        results.append({'certificate':str(cert),'key':str(key),'domains':domains,'expires':expiry})
    return {'certificates':results}

def issue(arg):
    if not arg.get('agree'):raise ValueError('请先确认 CA 服务条款')
    domain=domain_name(arg['domain']);email=arg.get('email','').strip()
    if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+',email):raise ValueError('请填写有效邮箱')
    method=arg.get('provider','cloudflare');token=arg.get('token','').strip()
    if method!='cloudflare' or not token:raise ValueError('请填写该域名所属 Cloudflare 区域的 DNS API 令牌')
    binary=client();slug=hashlib.sha256(domain.encode()).hexdigest()[:20]
    d=ROOT/'certificates'/slug;d.mkdir(parents=True,exist_ok=True);d.chmod(0o700)
    base=['/bin/sh',str(binary),'--home',str(binary.parent),'--config-home',str(d/'account'),'--cert-home',str(d/'issued')]
    env=dict(os.environ,CF_Token=token)
    r=subprocess.run(base+['--issue','--dns','dns_cf','-d',domain,'--server','letsencrypt','-m',email,'--keylength','ec-256'],env=env,capture_output=True,text=True,timeout=420)
    if r.returncode not in (0,2):
        raise ValueError('签发失败：'+(r.stdout+r.stderr)[-900:].replace(token,'[已隐藏]'))
    hook='/usr/bin/python3 /etc/sb-router/certificates.py deploy '+slug
    r=subprocess.run(base+['--install-cert','-d',domain,'--ecc','--key-file',str(d/'private.key'),
                           '--fullchain-file',str(d/'fullchain.pem'),'--reloadcmd',hook],
                     env=env,capture_output=True,text=True,timeout=30)
    if r.returncode or not key_matches(d/'fullchain.pem',d/'private.key'):raise ValueError('证书已申请，但安装或密钥校验失败，请查看签发日志')
    (d/'meta.json').write_text(json.dumps({'domain':domain,'email':email}))
    for p in [d/'private.key',d/'meta.json']:p.chmod(0o600)
    cron=pathlib.Path('/etc/crontabs/root');lines=cron.read_text().splitlines() if cron.exists() else []
    if not any('/etc/sb-router/certificates.py renew' in x for x in lines):
        lines.append('47 3 * * * /usr/bin/python3 /etc/sb-router/certificates.py renew >/tmp/sb-cert-renew.log 2>&1')
        subprocess.run(['crontab','-'],input=('\n'.join(lines)+'\n').encode(),check=True)
    return {'ok':True,'certificate':str(d/'fullchain.pem'),'key':str(d/'private.key'),'domains':[domain]}

def deploy(slug):
    if not re.fullmatch('[0-9a-f]{20}',slug):raise ValueError('证书标识无效')
    directory=ROOT/'certificates'/slug
    if not key_matches(directory/'fullchain.pem',directory/'private.key'):raise ValueError('更新后的证书和私钥不匹配')
    cfg=ROOT/'active.json'
    if cfg.exists() and str(directory) in cfg.read_text():
        subprocess.run(['/etc/init.d/sb-ingress','restart'],check=True)
    proxy=ROOT/'reverse-proxies.json'
    if proxy.exists() and str(directory) in proxy.read_text():
        import reverse_proxy
        reverse_proxy.reload_current()
def renew():
    binary=client()
    for meta in (ROOT/'certificates').glob('*/meta.json'):
        d=meta.parent
        r=subprocess.run(['/bin/sh',str(binary),'--home',str(binary.parent),'--config-home',str(d/'account'),
                          '--cert-home',str(d/'issued'),'--cron'],capture_output=True,text=True,timeout=420)
        if r.returncode:print('证书续期失败：'+json.loads(meta.read_text())['domain'],file=sys.stderr)
if __name__=='__main__':
    if sys.argv[1]=='renew':renew()
    elif sys.argv[1]=='deploy':deploy(sys.argv[2])
