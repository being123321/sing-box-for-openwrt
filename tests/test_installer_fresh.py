import os,pathlib,subprocess,sys,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]

@unittest.skipUnless(sys.platform.startswith('linux'),'POSIX installer fixtures')
class FreshInstallerTests(unittest.TestCase):
    def test_root_crontab_created_and_existing_jobs_preserved(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            root=pathlib.Path(folder);crontabs=root/'crontabs'
            source=(ROOT/'install.sh').read_text()
            block='mkdir -p /etc/crontabs'+source.split('mkdir -p /etc/crontabs',1)[1].split('/etc/sb-router/manage cli migrate-item-updates',1)[0]
            block=block.replace('/etc/crontabs',str(crontabs))
            subprocess.run(['/bin/sh','-ec',block],check=True)
            cron=crontabs/'root';self.assertTrue(cron.is_file());self.assertEqual(cron.stat().st_mode&0o777,0o600)
            cron.write_text('5 2 * * * existing-job\n')
            subprocess.run(['/bin/sh','-ec',block],check=True)
            self.assertEqual(cron.read_text(),'5 2 * * * existing-job\n')
    def test_opkg_user_installed_dependencies_do_not_trigger_downloads(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            root=pathlib.Path(folder);bin=root/'bin';bin.mkdir();release=root/'release';release.touch();log=root/'opkg.log'
            def exe(name,body):
                p=bin/name;p.write_text('#!/bin/sh\n'+body);p.chmod(0o755);return p
            procd=exe('procd','exit 0\n');exe('uname','[ "$1" = -s ] && echo Linux || echo i686\n');exe('id','echo 0\n')
            exe('ubus','echo "{}"\n');exe('jsonfilter','cat >/dev/null; echo fixture\n')
            exe('opkg','if [ "$1" = status ]; then echo "Status: install user installed"; else echo "$*" >> "$OPKG_TEST_LOG"; exit 1; fi\n')
            source=(ROOT/'install.sh').read_text().replace('/etc/openwrt_release',str(release)).replace('/sbin/procd',str(procd))
            source=source.replace('if command -v apk >/dev/null 2>&1; then PM=apk','if false; then PM=apk')
            script=root/'install.sh';script.write_text(source)
            result=subprocess.run(['/bin/sh',str(script),'--deps-only'],env=dict(os.environ,PATH=str(bin)+':'+os.environ['PATH'],OPKG_TEST_LOG=str(log)),capture_output=True,text=True,timeout=10)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr);self.assertFalse(log.exists());self.assertIn('All dependencies are installed.',result.stdout)

if __name__=='__main__':unittest.main()
