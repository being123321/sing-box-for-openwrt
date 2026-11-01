import importlib.util,os,pathlib,subprocess,sys,types,unittest,tempfile,json
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'files/etc/sb-router'))
import core_update

class SourceTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform.startswith('linux'),'OpenWrt runtime imports fcntl')
    def test_unified_schedule_survives_portable_initialization(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as tmp:
            cron=pathlib.Path(tmp)/'cron'
            cron.write_text('15 3 * * 1 /etc/sb-router/manage cli refresh-selected >/tmp/log 2>&1\n')
            source=(ROOT/'files/etc/sb-router/manage').read_text(encoding='utf-8').split('\nmethods = ',1)[0]
            source=source.replace("LAN = lan_address()","LAN = '192.0.2.1'")
            source=source.replace("pathlib.Path('/etc/sb-router')","pathlib.Path(TEST_DIR)")
            source=source.replace("pathlib.Path('/etc/crontabs/root')","pathlib.Path(TEST_CRON)")
            scope={'__name__':'schedule_test','TEST_DIR':tmp,'TEST_CRON':str(cron)}
            exec(source,scope)
            scope['ensure_base']()
            result=scope['update_options']()
            self.assertEqual(result['schedule']['mode'],'weekly')
            self.assertEqual(result['schedule']['hour'],3)
            self.assertEqual(result['schedule']['minute'],15)
            self.assertEqual(result['selected'],[])
    def test_sources_compile(self):
        for p in (ROOT/'files').rglob('*'):
            if p.is_file() and (p.suffix=='.py' or p.name in ('manage','dns-hook','luci.sbrouter')):
                compile(p.read_bytes(),str(p),'exec')
    def test_architecture_and_abi(self):
        original_path=core_update.pathlib.Path
        original_uname=getattr(core_update.os,'uname',None)
        try:
            for machine,loader,target in [
                ('x86_64','x86_64','amd64-musl'),('aarch64','aarch64','arm64-musl'),
                ('armv7l','armhf','armv7-musl'),('riscv64','riscv64','riscv64-musl'),
                ('loongarch64','loongarch64','loong64-musl'),('i686','i386','386-musl'),
                ('x86_64',None,'amd64')]:
                core_update.os.uname=lambda:types.SimpleNamespace(machine=machine,sysname='Linux')
                content=b'/lib/ld-musl-'+loader.encode()+b'.so.1\0' if loader else b'glibc'
                core_update.pathlib.Path=lambda path:types.SimpleNamespace(read_bytes=lambda:content)
                self.assertEqual(core_update.platform_target(),target)
        finally:
            core_update.pathlib.Path=original_path
            if original_uname is None:del core_update.os.uname
            else:core_update.os.uname=original_uname
    def test_custom_source_validation(self):
        url='https://github.com/SagerNet/sing-box/releases/download/v1.0.0/core.tar.gz'
        self.assertEqual(core_update.source_url('official',url),url)
        self.assertEqual(core_update.source_url('https://mirror.example/{url}',url),'https://mirror.example/'+url)
        for bad in ['http://mirror.example/','file:///tmp/core','https://u:p@mirror.example/','https://mirror.example/#fragment']:
            with self.assertRaises(ValueError):core_update.source_prefix(bad)
    def test_package_has_no_core_or_state(self):
        for p in (ROOT/'files').rglob('*'):
            self.assertNotIn(p.name,('core','token','active.json','tun.json','system.json','cache.db'))
            self.assertNotEqual(p.suffix,'.pem')
        self.assertIn('--no-core',(ROOT/'install.sh').read_text())
        self.assertIn('upload-check',(ROOT/'files/etc/sb-router/core_update.py').read_text(encoding='utf-8'))
if __name__=='__main__':unittest.main()
