import pathlib,sys,tempfile,hashlib,re,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'files/etc/sb-router'))
import core_update

class CompatTests(unittest.TestCase):
    def test_sha256_works_without_python311_file_digest(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            p=pathlib.Path(folder)/'fixture';p.write_bytes(b'fixture-data'*(1024*200))
            self.assertEqual(core_update.sha256_file(p),hashlib.sha256(p.read_bytes()).hexdigest())
    def test_held_user_dependency_flags_are_installed_but_errors_are_not(self):
        source=(ROOT/'files/etc/sb-router/manage').read_text(encoding='utf-8')
        pattern=re.search(r"re.search\(r'([^']*Status:[^']*)'",source).group(1)
        for flags in ('ok','user','hold,user','hold,ok'):
            self.assertIsNotNone(re.search(pattern,'Status: install '+flags+' installed',re.M))
        for status in ('Status: install reinstreq installed','Status: deinstall ok not-installed'):
            self.assertIsNone(re.search(pattern,status,re.M))

if __name__=='__main__':unittest.main()
