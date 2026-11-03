import copy,json,pathlib,sys,tempfile,unittest,types
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'files/etc/sb-router'))
import server_manager as servers

class ServerTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir=ROOT)
        self.previous=servers.ROOT
        servers.ROOT=pathlib.Path(self.tmp.name)
        self.baseline={'inbounds':[{'type':'socks','tag':'old','listen':'127.0.0.1','listen_port':24443},
                                   {'type':'http','tag':'system-http','listen':'127.0.0.1','listen_port':18081}]}
        (servers.ROOT/'ingress-extra.json').write_text(json.dumps(self.baseline))
    def tearDown(self):
        servers.ROOT=self.previous
        self.tmp.cleanup()
    def args(self,tag='new'):
        return {'id':'','revision':servers.snapshot()[1],'enabled':True,'route':'direct',
                'value':json.dumps({'type':'socks','tag':tag,'listen':'127.0.0.1','listen_port':23456,'users':[{'username':'test','password':'test-password'}]})}
    def store(self,value):
        (servers.ROOT/'servers.json').write_text(json.dumps(value))
    def test_existing_servers_and_internal_interface(self):
        rows=servers.entries()
        self.assertEqual([x['id'] for x in rows],['old','system-http'])
        self.assertFalse(rows[0]['protected']);self.assertTrue(rows[1]['protected'])
        with self.assertRaises(ValueError):servers.proposed(dict(self.args(),id='system-http'),True)
    def test_add_and_disable_preserves_old_servers(self):
        self.store(servers.proposed(self.args()))
        cfg={'inbounds':copy.deepcopy(self.baseline['inbounds'])+[{'type':'socks','tag':'lan-forward','listen_port':18082}],
             'outbounds':[{'type':'direct','tag':'DIRECT'}],'route':{'rules':[{'ip_is_private':True,'outbound':'DIRECT'}]}}
        applied=servers.configure(copy.deepcopy(cfg))
        self.assertEqual({x['tag'] for x in applied['inbounds']},{'old','system-http','new','lan-forward'})
        self.assertEqual(applied['route']['rules'][0]['outbound'],servers.DIRECT_TAG)
        a=self.args();a.update(id='new',enabled=False);self.store(servers.proposed(a))
        disabled=servers.configure(applied)
        self.assertNotIn('new',[x['tag'] for x in disabled['inbounds']])
        self.assertIn('old',[x['tag'] for x in disabled['inbounds']])
    def test_delete_survives_subscription_render(self):
        self.store(servers.proposed(dict(self.args(),id='old'),True))
        cfg=servers.configure({'inbounds':copy.deepcopy(self.baseline['inbounds']),'outbounds':[]})
        self.assertNotIn('old',[x['tag'] for x in cfg['inbounds']])
        self.assertIn('system-http',[x['tag'] for x in cfg['inbounds']])
    def test_stale_revision_reserved_port_and_open_proxy_rejected(self):
        a=self.args();a['revision']='old'
        with self.assertRaises(ValueError):servers.proposed(a)
        for config in [
            {'type':'socks','tag':'test','listen':'127.0.0.1','listen_port':9090},
            {'type':'mixed','tag':'test','listen':'::','listen_port':23456}]:
            with self.assertRaises(ValueError):servers.proposed(dict(self.args(),value=json.dumps(config)))
    @unittest.skipUnless(sys.platform.startswith('linux'),'OpenWrt imports fcntl')
    def test_activation_failure_restores_server_file_and_running_config(self):
        source=(ROOT/'files/etc/sb-router/manage').read_text(encoding='utf-8').split('\nmethods = ',1)[0]
        source=source.replace("LAN = lan_address()","LAN = '192.0.2.1'")
        source=source.replace("pathlib.Path('/etc/sb-router')","pathlib.Path(TEST_DIR)")
        scope={'__name__':'server_transaction_test','TEST_DIR':str(servers.ROOT)}
        exec(source,scope)
        before=json.dumps({'inbounds':self.baseline['inbounds'],'outbounds':[{'type':'direct','tag':'DIRECT'}]}).encode()
        (servers.ROOT/'active.json').write_bytes(before)
        calls=[]
        def check(cfg):
            path=servers.ROOT/'candidate.json';path.write_text(json.dumps(cfg));return path
        scope.update(check=check,healthy=lambda:False,wait_backend=lambda old:False,core_pid=lambda:123,
                     sp=types.SimpleNamespace(run=lambda *args,**kwargs:calls.append(args[0])))
        with self.assertRaises(RuntimeError):scope['server_change'](self.args())
        self.assertFalse((servers.ROOT/'servers.json').exists())
        self.assertEqual((servers.ROOT/'active.json').read_bytes(),before)
        self.assertEqual(calls,[['/etc/init.d/sb-ingress','restart'],['/etc/init.d/sb-ingress','restart']])

if __name__=='__main__':unittest.main()
