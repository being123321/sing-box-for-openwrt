#!/usr/bin/env python3
"""Build architecture-independent management packages, never a sing-box core."""
import argparse,hashlib,io,pathlib,shutil,subprocess,tarfile,tempfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
EXEC={'manage','dns-hook','setup.py','luci.sbrouter','sb-router','sb-ingress','sb-panels','sb-network-guard','sb-core-guard','sb-reverse-proxy'}
def tar(items):
    out=io.BytesIO()
    with tarfile.open(fileobj=out,mode='w:gz',format=tarfile.GNU_FORMAT) as t:
        for name,data,mode in sorted(items):
            info=tarfile.TarInfo('./'+name);info.size=len(data);info.mode=mode;info.mtime=0
            t.addfile(info,io.BytesIO(data))
    return out.getvalue()
def ar(items):
    result=b'!<arch>\n'
    for name,data in items:
        result+=(f'{name+"/":<16}{0:<12}{0:<6}{0:<6}{"100644":<8}{len(data):<10}'+chr(96)+'\n').encode()+data
        if len(data)%2:result+=b'\n'
    return result
def build(apk_tool=None):
    version=(ROOT/'VERSION').read_text().strip()
    dist=ROOT/'dist';dist.mkdir(exist_ok=True);items=[]
    for p in sorted((ROOT/'files').rglob('*')):
        if not p.is_file() or '__pycache__' in p.parts or p.suffix=='.pyc':continue
        relative=p.relative_to(ROOT/'files').as_posix()
        assert p.name not in ('core','token','active.json','tun.json','system.json','cache.db')
        items.append((relative,p.read_bytes().replace(b'\r\n',b'\n'),0o755 if p.name in EXEC else 0o644))
    for p in (ROOT/'assets').iterdir():
        items.append(('etc/sb-router/web-helpers/'+p.name,p.read_bytes().replace(b'\r\n',b'\n'),0o644))
    items.append(('etc/sb-router/install-helper.sh',(ROOT/'install.sh').read_bytes().replace(b'\r\n',b'\n'),0o755))
    control=f'Package: luci-app-sb-router\nVersion: {version}-1\nArchitecture: all\nDepends: luci-base, python3, python3-yaml, curl\nDescription: sing-box for OpenWrt management, core downloaded separately\nMaintainer: being123321\nSection: luci\n'.encode()
    (dist/'luci-app-sb-router.ipk').write_bytes(ar([('debian-binary',b'2.0\n'),('control.tar.gz',tar([('control',control,0o644)])),('data.tar.gz',tar(items))]))
    if apk_tool:
        with tempfile.TemporaryDirectory() as tmp:
            for name,data,mode in items:
                p=pathlib.Path(tmp)/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data);p.chmod(mode)
            subprocess.run([apk_tool,'mkpkg','--info','name:luci-app-sb-router','--info','version:'+version+'-r1',
                            '--info','arch:noarch','--info','description:sing-box for OpenWrt management',
                            '--info','depends:luci-base python3 python3-yaml curl',
                            '--files',tmp,'--output',str(dist/'luci-app-sb-router.apk')],check=True)
    shutil.copyfile(ROOT/'install.sh',dist/'install.sh')
    outputs=[p for p in sorted(dist.iterdir()) if p.name!='SHA256SUMS' and p.is_file()]
    (dist/'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in outputs))
    print('Built',version,'without core or user configuration')
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--apk-tool');build(parser.parse_args().apk_tool)
