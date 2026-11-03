import json,pathlib,sys,tempfile,types,unittest,subprocess,shutil,copy
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'files/etc/sb-router'))
import item_updates as updates,server_manager as servers,managed_firewall as firewall,reverse_proxy,certificates,server_share

class ManagementTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir=ROOT);self.d=pathlib.Path(self.tmp.name)
        self.saved=(updates.ROOT,updates.CRON,updates.subprocess,servers.ROOT,firewall.ROOT,firewall.CONFIG,firewall.subprocess,firewall.uci,reverse_proxy.ROOT,reverse_proxy.PARENT,certificates.ROOT)
        updates.ROOT=servers.ROOT=firewall.ROOT=reverse_proxy.ROOT=certificates.ROOT=self.d
        updates.CRON=self.d/'cron';updates.CRON.write_text('10 3 * * * /usr/bin/other-renew\n0 2 * * * /etc/sb-router/manage cli refresh-selected\n')
        updates.subprocess=types.SimpleNamespace(run=self.crontab)
        firewall.CONFIG=self.d/'firewall';firewall.CONFIG.write_text('config rule user_manual\n')
        self.calls=[]
        firewall.uci=lambda *args:self.record(args)
        firewall.subprocess=types.SimpleNamespace(run=lambda args,**kw:self.record(args),DEVNULL=subprocess.DEVNULL)
        reverse_proxy.PARENT=self.d/'parent.cfg'
    def crontab(self,args,**kwargs):
        updates.CRON.write_bytes(kwargs['input'])
        return subprocess.CompletedProcess(args,0)
    def record(self,args):
        self.calls.append(tuple(args));return subprocess.CompletedProcess(args,0,stdout='',stderr='')
    def tearDown(self):
        (updates.ROOT,updates.CRON,updates.subprocess,servers.ROOT,firewall.ROOT,firewall.CONFIG,firewall.subprocess,firewall.uci,reverse_proxy.ROOT,reverse_proxy.PARENT,certificates.ROOT)=self.saved
        self.tmp.cleanup()
    def test_independent_update_schedules_and_legacy_migration(self):
        items=[{'id':'sub:one'},{'id':'profile:two'}]
        updates.migrate(items,{'selected':['sub:one'],'schedule':dict(updates.DEFAULT,enabled=True)})
        self.assertTrue(updates.get('sub:one')['enabled']);self.assertFalse(updates.get('profile:two')['enabled'])
        updates.set_policy('profile:two',dict(updates.DEFAULT,enabled=True,mode='monthly',day=12,hour=4,minute=30),[x['id'] for x in items])
        self.assertEqual(updates.get('sub:one')['hour'],2)
        text=updates.CRON.read_text()
        self.assertIn('30 4 12 * *',text);self.assertIn('/usr/bin/other-renew',text)
        self.assertNotIn('refresh-selected',text);self.assertEqual(text.count('# sb-router-item'),2)
    def test_only_owned_firewall_rules_removed_on_delete(self):
        state={'items':{'one':{'enabled':True,'firewall':True,'route':'direct','config':{'type':'hysteria2','tag':'one','listen':'::','listen_port':24449}}},'deleted':[]}
        (self.d/'servers.json').write_text(json.dumps(state))
        firewall.sync()
        owned=json.loads((self.d/'firewall-owned.json').read_text())
        self.assertEqual(len(owned),1);self.assertEqual(next(iter(owned.values()))['proto'],'udp')
        (self.d/'servers.json').write_text('{"items":{},"deleted":["one"]}')
        self.calls=[];firewall.sync()
        deleted=[x for x in self.calls if x[0]=='delete']
        self.assertEqual(deleted,[('delete','firewall.'+next(iter(owned)))])
        self.assertEqual(firewall.CONFIG.read_text(),'config rule user_manual\n')
    def test_share_uri_encodes_password_and_ipv6(self):
        (self.d/'ingress-extra.json').write_text(json.dumps({'inbounds':[{'type':'hysteria2','tag':'one','listen':'::','listen_port':24449,'users':[{'name':'a','password':'p@ss:word'}],'tls':{'enabled':True,'server_name':'node.example'}}]}))
        link=server_share.share({'id':'one','host':'2001:db8::1','user':0})['link']
        self.assertIn('p%40ss%3Aword@[2001:db8::1]:24449',link);self.assertIn('sni=node.example',link)
    def test_reverse_proxy_preserves_existing_parent_configuration(self):
        text='global\nfrontend api_tls\n    mode tcp\n    bind [::]:443 v6only\n    use_backend old if { req.ssl_sni -i old.example }\nbackend old\n    mode tcp\n    server existing 127.0.0.1:10444\n'
        reverse_proxy.PARENT.write_text(text)
        config,parent,rows=reverse_proxy.configure([{'id':'test','domain':'new.example','target':'http://127.0.0.1:3000','https':False,'port':18090,'enabled':True}])
        self.assertIn('server target 127.0.0.1:3000',config);self.assertEqual(parent,text)
        self.assertEqual(reverse_proxy.PARENT.read_text(),text)
    def test_certificate_domain_validation(self):
        self.assertEqual(certificates.domain_name('NODE.example'),'node.example')
        for bad in ['a;rm -rf /','https://example.com','localhost','test.example\nother']:
            with self.assertRaises(ValueError):certificates.domain_name(bad)
    @unittest.skipUnless(sys.platform.startswith('linux'),'OpenWrt runtime imports fcntl')
    def test_logs_remove_ansi_without_corrupting_chinese(self):
        source=(ROOT/'files/etc/sb-router/manage').read_text(encoding='utf-8').split('\nmethods = ',1)[0]
        source=source.replace("LAN = lan_address()","LAN = '192.0.2.1'").replace("pathlib.Path('/etc/sb-router')","pathlib.Path(TEST_DIR)")
        scope={'__name__':'log_test','TEST_DIR':str(self.d)};exec(source,scope)
        scope['sp']=types.SimpleNamespace(run=lambda *a,**kw:types.SimpleNamespace(stdout='\x1b[31mERROR\x1b[0m 中文日志\n'))
        rows=scope['logs']({'lines':20})['lines'];self.assertEqual(rows,['ERROR 中文日志'])

if __name__=='__main__':unittest.main()
