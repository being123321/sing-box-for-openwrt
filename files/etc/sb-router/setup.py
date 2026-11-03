#!/usr/bin/python3
"""Create missing state only; preserve user configuration."""
import re
import ipaddress,json,os,pathlib,secrets,shutil,sys,tempfile,zipfile
from router_platform import lan_address
D=pathlib.Path('/etc/sb-router')
# Cache-busting version for the injected panel helpers; keep in step with VERSION.
HELPER_VERSION='1.10.7'
PANELS={'official':('SagerNet/sing-box-dashboard','gh-pages'),'yacd':('MetaCubeX/Yacd-meta','gh-pages'),
        'metacubexd':('MetaCubeX/metacubexd','gh-pages'),'zashboard':('Zephyruso/zashboard','gh-pages')}

def init():
    os.umask(0o077)
    D.mkdir(parents=True,exist_ok=True)
    (D/'profiles').mkdir(exist_ok=True)
    for name,value in [('token',secrets.token_urlsafe(32)),('panel.json','{"id":"official","url":""}'),
                       ('profiles/base.json','{"base":true,"nodes":[],"subs":[]}'),('update-selection.json','{"selected":[]}')]:
        path=D/name
        if not path.exists():path.write_text(value)
    tun=D/'tun.json'
    if not tun.exists():
        import subprocess
        state=json.loads(subprocess.check_output(['ubus','call','network.interface.lan','status']))
        addr=state['ipv4-address'][0]
        subnet=str(ipaddress.IPv4Network(addr['address']+'/'+str(addr['mask']),strict=False))
        cfg={'log':{'level':'warn'},'inbounds':[{
            'type':'tun','tag':'tun-in','interface_name':'sb-zh','address':['172.29.254.1/30','fdfe:dcba:9876::1/126'],
            'mtu':1480,'auto_route':True,'auto_redirect':True,'strict_route':True,
            'include_interface':[state.get('l3_device') or 'br-lan'],'route_exclude_address':[subnet]}],
            'dns':{'servers':[{'type':'udp','tag':'local','server':'127.0.0.1','server_port':15353}]},
            'outbounds':[{'type':'socks','tag':'gateway','server':'127.0.0.1','server_port':18082}],
            'route':{'auto_detect_interface':True,'final':'gateway','rules':[{'port':53,'action':'hijack-dns'}]}}
        tun.write_text(json.dumps(cfg))
    print('LAN:',lan_address(),'; management ready; import a configuration before enabling TUN')

def panels():
    from core_update import download
    helpers=D/'web-helpers';failures=[]
    for name,(repo,ref) in PANELS.items():
        dest=D/'ui' if name=='official' else D/'panels'/name
        if (dest/'index.html').exists():
            if name=='official':
                index=dest/'index.html';text=index.read_text()
                text=re.sub(r'<script src="\./official-connect\.js[^"]*"></script>','',text)
                text=text.replace('<head>','<head><script src="./official-connect.js?v='+HELPER_VERSION+'"></script>',1);index.write_text(text)
            for filename in (('official-connect.js',) if name=='official' else ('luci-connect.html','luci-connect.js')):
                shutil.copyfile(helpers/filename,dest/filename)
            continue
        try:
            with tempfile.TemporaryDirectory(dir=D,prefix='.panel-') as tmp:
                archive=pathlib.Path(tmp)/'panel.zip'
                download('https://github.com/'+repo+'/archive/refs/heads/'+ref+'.zip',archive)
                stage=pathlib.Path(tmp)/'files';stage.mkdir();total=0
                with zipfile.ZipFile(archive) as z:
                    for item in z.infolist():
                        if item.is_dir():continue
                        relative=pathlib.PurePosixPath(item.filename).parts[1:]
                        if not relative or '..' in relative:raise ValueError('Invalid panel archive')
                        total+=item.file_size
                        if total>100000000:raise ValueError('Panel archive too large')
                        target=stage.joinpath(*relative);target.parent.mkdir(parents=True,exist_ok=True)
                        target.write_bytes(z.read(item))
                if not (stage/'index.html').exists():raise ValueError('Missing panel index')
                if name=='official':
                    index=stage/'index.html'
                    index.write_text(index.read_text().replace('<head>','<head><script src="./official-connect.js?v='+HELPER_VERSION+'"></script>',1))
                    shutil.copyfile(helpers/'official-connect.js',stage/'official-connect.js')
                else:
                    for file in ('luci-connect.html','luci-connect.js'):shutil.copyfile(helpers/file,stage/file)
                dest.parent.mkdir(parents=True,exist_ok=True)
                if dest.exists():dest.rmdir()
                os.replace(stage,dest)
                print('Panel ready:',name)
        except Exception as exc:failures.append(name+': '+str(exc))
    if failures:raise RuntimeError('; '.join(failures))

if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='panels':panels()
    else:init()
