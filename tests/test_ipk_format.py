import importlib.util,io,pathlib,tempfile,tarfile,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('package_builder',ROOT/'scripts/build.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)

class IpkTests(unittest.TestCase):
    def test_openwrt_opkg_container_control_payload_and_modes(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            root=pathlib.Path(folder);(root/'files/etc/sb-router').mkdir(parents=True);(root/'assets').mkdir()
            (root/'VERSION').write_text('1.10.5\n');(root/'install.sh').write_text('#!/bin/sh\nexit 0\n')
            (root/'files/etc/sb-router/manage').write_text('#!/usr/bin/python3\n')
            old=builder.ROOT;builder.ROOT=root
            try:builder.build()
            finally:builder.ROOT=old
            package=root/'dist/luci-app-sb-router.ipk'
            self.assertEqual(package.read_bytes()[:2],b'\x1f\x8b')
            with tarfile.open(package,'r:gz') as outer:
                self.assertEqual(outer.getnames(),['./debian-binary','./data.tar.gz','./control.tar.gz'])
                self.assertEqual(outer.extractfile('./debian-binary').read(),b'2.0\n')
                with tarfile.open(fileobj=io.BytesIO(outer.extractfile('./control.tar.gz').read()),mode='r:gz') as control:
                    text=control.extractfile('./control').read().decode();self.assertIn('Architecture: all',text);self.assertIn('Version: 1.10.5-1',text)
                with tarfile.open(fileobj=io.BytesIO(outer.extractfile('./data.tar.gz').read()),mode='r:gz') as data:
                    self.assertEqual(data.getmember('./etc/sb-router/manage').mode,0o755)
                    self.assertFalse(any(pathlib.PurePosixPath(n).name in ('core','token','active.json','tun.json') for n in data.getnames()))
                    # opkg's extractor opens files directly; it does not create missing parents.
                    # Simulate an empty root using mkdir only for explicit tar directory entries.
                    empty=root/'empty-root';empty.mkdir()
                    for member in data:
                        dest=empty/member.name
                        if member.isdir():dest.mkdir(exist_ok=True)
                        elif member.isfile():
                            self.assertTrue(dest.parent.is_dir(),'Missing directory entry before '+member.name)
                            dest.write_bytes(data.extractfile(member).read())
                    self.assertTrue((empty/'etc/sb-router/manage').is_file())
                    self.assertTrue((empty/'etc/sb-router/install-helper.sh').is_file())

if __name__=='__main__':unittest.main()
