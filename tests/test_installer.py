import json,os,pathlib,shutil,subprocess,sys,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
@unittest.skipUnless(sys.platform.startswith('linux'),'POSIX installer integration test')
class InstallerTests(unittest.TestCase):
    def test_missing_feed_repaired_without_installing_foreign_kernel(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as tmp:
            d=pathlib.Path(tmp);bin=d/'bin';bin.mkdir();feeds=d/'feeds';feeds.mkdir()
            (feeds/'original.list').write_text('https://mirror.example/releases/25.12.2/targets/x86/64/kmods/6.12.103-EXACT/packages.adb\n')
            release=d/'openwrt_release';release.touch()
            def exe(name,text):
                p=bin/name;p.write_text(text);p.chmod(0o755);return p
            exe('uname','#!/bin/sh\n[ "$1" = -s ] && echo Linux || echo x86_64\n')
            exe('id','#!/bin/sh\necho 0\n')
            board={'release':{'distribution':'ImmortalWrt','version':'25.12.2','target':'x86/64','description':'test firmware'}}
            exe('ubus',"#!/bin/sh\necho '"+json.dumps(board)+"'\n")
            exe('jsonfilter',"#!/usr/bin/env python3\nimport json,sys\nx=json.load(sys.stdin)\nfor part in sys.argv[2][2:].split('.'):x=x[part]\nprint(x)\n")
            exe('apk','''#!/bin/sh
case "$1" in
 --print-arch) echo x86_64 ;;
 info) [ "$3" != curl ] ;;
 update) exit 0 ;;
 add)
   echo "$*" >> "$TEST_ADD_LOG"
   [ -f "$TEST_FEED" ] || exit 1
   echo '(1/1) Installing curl'
   ;;
esac
''')
            procd=exe('procd','#!/bin/sh\nexit 0\n')
            source=(ROOT/'install.sh').read_text()
            source=source.replace('/etc/openwrt_release',str(release)).replace('/sbin/procd',str(procd)).replace('/etc/apk/repositories.d',str(feeds))
            script=d/'install.sh';script.write_text(source)
            env=dict(os.environ,PATH=str(bin)+':'+os.environ['PATH'],TEST_FEED=str(feeds/'sb-router-official.list'),TEST_ADD_LOG=str(d/'add.log'))
            result=subprocess.run(['/bin/sh',str(script),'--deps-only'],env=env,capture_output=True,text=True,timeout=20)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            text=(feeds/'sb-router-official.list').read_text()
            self.assertIn('https://downloads.immortalwrt.org/releases/25.12.2/packages/x86_64/base/packages.adb',text)
            self.assertIn('kmods/6.12.103-EXACT/packages.adb',text)
            calls=(d/'add.log').read_text()
            self.assertIn('--simulate',calls)
            self.assertNotIn('--force',calls)
if __name__=='__main__':unittest.main()
