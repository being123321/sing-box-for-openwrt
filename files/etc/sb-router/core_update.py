from router_platform import api_url
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.parse

ROOT=pathlib.Path('/etc/sb-router')
API='https://api.github.com/repos/SagerNet/sing-box/releases'
ORIGIN='https://github.com/SagerNet/sing-box/releases/download/'
SOURCES={'official':'','ghfast':'https://ghfast.top/','ghproxy':'https://gh-proxy.com/'}

def source_prefix(source):
    if source in SOURCES:return SOURCES[source]
    parsed=urllib.parse.urlsplit(source.replace('{url}',''))
    if parsed.scheme!='https' or not parsed.netloc or parsed.username or parsed.password or parsed.fragment:
        raise ValueError('自定义来源必须是有效的 HTTPS 地址，不能带账号、密码或片段')
    return source

def source_url(source,url):
    prefix=source_prefix(source)
    if '{url}' in prefix:return prefix.replace('{url}',url)
    return prefix.rstrip('/')+'/'+url if prefix else url

def preferences():
    try:return json.loads((ROOT/'core-update-settings.json').read_text())
    except (OSError,ValueError):return {'source':'official','channel':'testing'}

def download(url, target=None):
    args=['curl','-4fsSL','--proto','=https','--proto-redir','=https','--connect-timeout','7','--max-time','150' if target else '25','--max-filesize',str(120000000 if target else 16000000)]
    if target:args+=['-o',str(target)]
    for network in (['--noproxy','*'],['--proxy','http://127.0.0.1:18081']):
        r=subprocess.run(args+network+[url],capture_output=True)
        if r.returncode==0:return r.stdout
    raise ValueError('无法从所选地址下载，请稍后重试或选择其他来源')

def platform_target():
    # The running Python process identifies the userspace ABI even on a 64-bit kernel with 32-bit userspace.
    machine=os.uname().machine.lower()
    elf=pathlib.Path('/proc/self/exe').read_bytes()
    loader=re.search(rb'/lib/ld-musl-([\w-]+)\.so\.1\x00',elf)
    if not loader:
        base={'x86_64':'amd64','amd64':'amd64','i686':'386','i586':'386','i486':'386','i386':'386',
              'aarch64':'arm64','arm64':'arm64','armv7l':'armv7','armv8l':'armv7','armv6l':'armv6',
              'riscv64':'riscv64','loongarch64':'loong64','ppc64le':'ppc64le','s390x':'s390x'}.get(machine)
        if not base:raise ValueError('官方包尚未适配当前架构：'+machine)
        return base
    abi=loader.group(1).decode('ascii')
    targets={'x86_64':'amd64-musl','i386':'386-musl','aarch64':'arm64-musl',
             'riscv64':'riscv64-musl','loongarch64':'loong64-musl',
             'powerpc64le':'ppc64le','s390x':'s390x','mipsel-sf':'mipsle-softfloat-musl',
             'mips-sf':'mips-softfloat','mips64-sf':'mips64-softfloat','mips64el-sf':'mips64le-softfloat'}
    machine=os.uname().machine.lower()
    if abi=='armhf' and machine in ('armv7l','armv8l','aarch64'):return 'armv7-musl'
    if abi in ('arm','armhf') and machine=='armv6l':return 'armv6'
    if abi=='arm' and machine.startswith('armv5'):return 'armv5'
    if abi not in targets:raise ValueError('官方包尚未适配当前架构：'+machine+' / '+abi)
    return targets[abi]

def platform_os():
    sysname=os.uname().sysname.lower()
    if sysname!='linux':raise ValueError('仅支持 Linux 系统，当前：'+sysname)
    return 'linux'

def latest(channel,target):
    if channel=='stable':release=json.loads(download(API+'/latest'))
    elif channel=='testing':
        release=None
        for page in range(1,5):
            items=json.loads(download(API+'?per_page=8&page='+str(page)))
            release=next((r for r in items if r['prerelease'] and not r['draft']),None)
            if release or len(items)<8:break
        if not release:raise ValueError('未找到测试版')
    else:raise ValueError('版本通道无效')
    tag=release['tag_name']
    if not re.fullmatch(r'v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?',tag):raise ValueError('发布标签无效')
    name='sing-box-'+tag[1:]+'-'+platform_os()+'-'+target+'.tar.gz'
    asset=next((a for a in release['assets'] if a['name']==name),{})
    url=ORIGIN+tag+'/'+name
    digest=asset.get('digest') or ''
    if asset.get('browser_download_url')!=url or not re.fullmatch('sha256:[0-9a-f]{64}',digest):raise ValueError('官方未提供可校验的 '+target+' 安装包')
    return tag,url,digest[7:],asset['size']

def version(binary):
    try:
        s=subprocess.check_output([str(binary),'version'],text=True,stderr=subprocess.DEVNULL)
    except (OSError,subprocess.CalledProcessError):
        return ''
    lines=s.splitlines()
    return lines[0].split()[-1] if lines else ''

def live(binary,config):
    for proc in pathlib.Path('/proc').glob('[0-9]*'):
        try:
            if os.path.samefile(proc/'exe',binary) and os.fsencode(config) in (proc/'cmdline').read_bytes().split(b'\0'):return True
        except OSError:pass
    return False

def restart(binary,tun):
    if not (ROOT/'active.json').exists():return
    for svc in (['sb-ingress','sb-router'] if tun else ['sb-ingress']):
        subprocess.run(['/etc/init.d/'+svc,'restart'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    for attempt in range(24):
        if live(binary,ROOT/'active.json') and (not tun or live(binary,ROOT/'tun.json')):
            r=subprocess.run(['curl','--max-time','2','-fsS','-H','Authorization: Bearer '+(ROOT/'token').read_text(),api_url('/version')],capture_output=True)
            if r.returncode==0 and version(binary) in json.loads(r.stdout).get('version',''):
                r=subprocess.run(['curl','--max-time','8','--proxy','http://127.0.0.1:18081','-fsS','-o','/dev/null','https://www.gstatic.com/generate_204'],capture_output=True)
                if not r.returncode:return
        time.sleep(1)
    raise RuntimeError('重启后健康检查未通过')

def recover(force=False):
    marker=ROOT/'core.update-pending'
    if not marker.exists():
        return {'recovered':False}
    try:
        data=json.loads(marker.read_text())
    except Exception:
        data={}
    if not force and time.time()-float(data.get('time',0))<120:
        return {'recovered':False,'pending':True}
    core=ROOT/'core';prev=ROOT/'core.previous'
    old_sha=str(data.get('old_sha') or '')
    if old_sha and core.exists():
        try:
            if hashlib.sha256(core.read_bytes()).hexdigest()==old_sha:
                marker.unlink(missing_ok=True)
                return {'recovered':False,'unchanged':True}
        except OSError:
            pass
    if not prev.exists():
        marker.unlink(missing_ok=True)
        return {'recovered':False}
    os.replace(prev,core)
    marker.unlink(missing_ok=True)
    if (ROOT/'active.json').exists() and pathlib.Path('/sys/class/net/sb-zh').exists():
        try:
            restart(core,True)
        except Exception:
            pass
    return {'recovered':True}


def handle(arg):
    mode=arg['mode']
    if mode in ('upload-check','upload-install'):return uploaded(arg)
    try:
        if mode in ('check','install'):
            recover(False)
    except Exception:
        pass
    if mode=='rollback':
        core=ROOT/'core';prev=ROOT/'core.previous'
        if not prev.exists():raise ValueError('没有可回退的内核版本')
        if not core.exists():raise ValueError('当前没有已安装的内核')
        tun=pathlib.Path('/sys/class/net/sb-zh').exists()
        tmp=ROOT/'core.rollback'
        os.replace(core,tmp);os.replace(prev,core)
        try:restart(core,tun)
        except Exception:
            os.replace(core,prev);os.replace(tmp,core)
            try:restart(core,tun)
            except Exception:pass
            raise RuntimeError('回退失败，已恢复原内核')
        os.replace(tmp,prev)
        return {'current':version(core),'message':'已回退到上一版本'}
    if mode=='ensure':mode='install';arg.setdefault('version','')
    if mode not in ('check','verify','install'):raise ValueError('更新选项无效')
    source_prefix(arg['source'])
    if arg['channel'] not in ('stable','testing'):raise ValueError('版本通道无效')
    settings=ROOT/'core-update-settings.json'
    tmp_settings=ROOT/'core-update-settings.json.tmp'
    tmp_settings.write_text(json.dumps({'source':arg['source'],'channel':arg['channel']}))
    tmp_settings.chmod(0o600)
    os.replace(tmp_settings,settings)
    core=ROOT/'core'
    current=version(core) or '未安装'
    installed=current!='未安装'
    target=platform_target()
    tag,url,digest,size=latest(arg['channel'],target)
    result={'current':current,'installed':installed,'latest':tag[1:],'updateAvailable':current!=tag[1:],'system':platform_os(),'arch':os.uname().machine.lower(),'target':platform_os()+'-'+target}
    if mode=='check':return result
    if arg.get('version') and tag[1:]!=arg['version']:raise ValueError('官方版本已改变，请重新检查')
    if mode=='install' and current==tag[1:]:return dict(result,message='已是此版本')
    with tempfile.TemporaryDirectory(dir=ROOT,prefix='.upgrade-') as tmp:
        archive=pathlib.Path(tmp)/'download'
        binary=pathlib.Path(tmp)/'core'
        download(source_url(arg['source'],url),archive)
        with archive.open('rb') as f:
            if archive.stat().st_size!=size or hashlib.file_digest(f,'sha256').hexdigest()!=digest:raise ValueError('安装包未通过官方 SHA-256 校验')
        with tarfile.open(archive,'r:gz') as t:
            members=[m for m in t if m.isfile() and pathlib.PurePosixPath(m.name).name=='sing-box']
            if len(members)!=1 or members[0].size>256*1024*1024:raise ValueError('发布包内容无效')
            with binary.open('wb') as f:shutil.copyfileobj(t.extractfile(members[0]),f)
        binary.chmod(0o755)
        if version(binary)!=tag[1:]:raise ValueError('内核版本不匹配')
        for name in ['active.json','tun.json']:
            cfg=ROOT/name
            if not cfg.exists():continue
            q=subprocess.run([str(binary),'check','-D',str(ROOT),'-c',str(cfg)],capture_output=True)
            if q.returncode:raise ValueError('此内核不兼容 '+name+'，当前服务继续运行')
        if mode=='verify':return dict(result,message='SHA-256、版本和两份运行配置均已通过校验')
        return activate_binary(binary,tmp,result)

def uploaded(arg):
    upload=pathlib.Path('/tmp/sb-router-core-upload')
    if upload.is_symlink() or not upload.is_file() or upload.stat().st_size>120000000:
        raise ValueError('上传文件不存在或超过 120 MB')
    digest=hashlib.sha256(upload.read_bytes()).hexdigest()
    if not re.fullmatch('[0-9a-f]{64}',arg.get('sha256','')) or digest!=arg['sha256']:
        raise ValueError('上传文件校验失败，请重新上传')
    with tempfile.TemporaryDirectory(dir=ROOT,prefix='.upload-') as tmp:
        binary=pathlib.Path(tmp)/'core'
        with upload.open('rb') as f:magic=f.read(4)
        if magic==b'\x7fELF':shutil.copyfile(upload,binary)
        else:
            try:
                with tarfile.open(upload,'r:gz') as archive:
                    members=[x for x in archive if x.isfile() and pathlib.PurePosixPath(x.name).name=='sing-box']
                    if len(members)!=1 or members[0].size>256*1024*1024:raise ValueError('压缩包必须只包含一个 sing-box 可执行文件')
                    with binary.open('wb') as f:shutil.copyfileobj(archive.extractfile(members[0]),f)
            except tarfile.TarError:
                raise ValueError('请选择 sing-box Linux 可执行文件或官方 .tar.gz 安装包')
        header=binary.read_bytes()[:64]
        own=pathlib.Path('/proc/self/exe').read_bytes()[:64]
        if len(header)<64 or header[:4]!=b'\x7fELF' or header[4:6]!=own[4:6] or header[18:20]!=own[18:20]:
            raise ValueError('上传的内核与当前系统 CPU 架构不匹配')
        binary.chmod(0o755)
        latest_version=version(binary)
        if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?',latest_version):
            raise ValueError('文件无法运行或不是有效的 sing-box 内核')
        for name in ('active.json','tun.json'):
            cfg=ROOT/name
            if cfg.exists():
                r=subprocess.run([str(binary),'check','-D',str(ROOT),'-c',str(cfg)],capture_output=True,timeout=30)
                if r.returncode:raise ValueError('上传内核不兼容 '+name+'，当前服务继续运行')
        result={'current':version(ROOT/'core') or '未安装','latest':latest_version,
                'target':platform_os()+'-'+platform_target(),'sha256':digest,'updateAvailable':True}
        if arg['mode']=='upload-check':return dict(result,message='架构、版本和配置校验通过，等待确认安装')
        if arg.get('version')!=latest_version:raise ValueError('文件版本已改变，请重新上传校验')
        result=activate_binary(binary,tmp,result)
        upload.unlink(missing_ok=True)
        return result

def activate_binary(binary,tmp,result):
    core=ROOT/'core'
    tun=pathlib.Path('/sys/class/net/sb-zh').exists()
    backup=ROOT/'core.previous'
    link=pathlib.Path(tmp)/'previous'
    had_old=core.exists()
    if had_old:
        os.link(core,link);os.replace(link,backup)
    marker=ROOT/'core.update-pending'
    old_sha=hashlib.sha256(core.read_bytes()).hexdigest() if core.exists() else ''
    marker.write_text(json.dumps({'target':result['latest'],'time':int(time.time()),'old_sha':old_sha}))
    os.replace(binary,core)
    try:
        restart(core,tun)
    except Exception:
        marker.unlink(missing_ok=True)
        if had_old:
            os.replace(backup,core);restart(core,tun)
        raise RuntimeError('更新失败，已恢复旧内核')
    marker.unlink(missing_ok=True)
    return dict(result,current=version(core),installed=True,updateAvailable=False,message='安装完成，健康检查通过')

if __name__=='__main__':
    import sys
    args=[a for a in sys.argv[1:]]
    mode=args[0] if args else 'check'
    if mode=='recover':
        print(json.dumps(recover('force' in args),ensure_ascii=False))
        sys.exit(0)
    channel=args[1] if len(args)>1 else 'stable'
    source=args[2] if len(args)>2 else 'official'
    print(json.dumps(handle({'mode':mode,'channel':channel,'source':source,'version':''}),ensure_ascii=False))
