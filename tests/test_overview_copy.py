import copy,json,pathlib,subprocess,sys,tempfile,types,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'files/etc/sb-router'))
import profile_api,subscription_usage,site_checks

def node(tag):return dict(type='hysteria2',tag=tag,server='node.example',server_port=443,password='test-only')
def cfg(*nodes):return dict(outbounds=list(nodes)+[dict(type='selector',tag='PROXY',outbounds=[n['tag'] for n in nodes])])

class FeatureTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir=ROOT);self.d=pathlib.Path(self.tmp.name)
    def tearDown(self):self.tmp.cleanup()
    def test_per_profile_defaults_source_settings_and_reset(self):
        first=profile_api.settings(self.d,'first',{},'192.0.2.1');second=profile_api.settings(self.d,'second',{},'192.0.2.1')
        self.assertEqual(first['port'],9090);self.assertNotEqual(first['secret'],second['secret'])
        original={'experimental':{'clash_api':{'external_controller':'127.0.0.1:9190','secret':'source-secret'}}}
        value=profile_api.change(self.d,'first',original,'192.0.2.1',dict(port=9290,secret='edited-secret'))
        self.assertEqual(value['port'],9290)
        value=profile_api.change(self.d,'first',original,'192.0.2.1',dict(reset=True))
        self.assertEqual((value['port'],value['secret']),(9190,'source-secret'))
        self.assertEqual(profile_api.settings(self.d,'second',{},'192.0.2.1')['secret'],second['secret'])
        with self.assertRaises(ValueError):profile_api.change(self.d,'first',{},'192.0.2.1',dict(port=9091,secret='x'))
    def test_embedded_and_full_dashboards_have_separate_local_listeners(self):
        value=profile_api.patch({'outbounds':[]},dict(port=9190,secret='test-secret'),'192.0.2.1',self.d)
        self.assertEqual({s['listen_port'] for s in value['services']},{9091,9095})
        self.assertTrue(all(s['secret']=='test-secret' and s['listen']=='192.0.2.1' for s in value['services']))
        second=profile_api.patch(value,dict(port=9190,secret='next-secret'),'192.0.2.1',self.d)
        self.assertEqual(len(second['services']),2)
        with self.assertRaises(ValueError):profile_api.port(9095)

    def test_usage_headers_and_missing_provider_information(self):
        url='https://provider.example/sub'
        subscription_usage.record(self.d,url,'HTTP/2 200\r\nSubscription-Userinfo: upload=20; download=80; total=1000; expire=1800000000\r\n')
        usage=subscription_usage.info(self.d,url)
        self.assertTrue(usage['provided']);self.assertEqual(usage['remaining'],900);self.assertEqual(usage['expire'],1800000000)
        subscription_usage.record(self.d,url,'HTTP/2 200\r\n')
        self.assertTrue(subscription_usage.info(self.d,url)['provided'])
        self.assertTrue(subscription_usage.info(self.d,url)['stale'])
        self.assertTrue(subscription_usage.info(self.d,url)['reason'])
    def test_site_status_differentiates_http_restrictions_and_connection_errors(self):
        previous=(site_checks.CACHE,site_checks.subprocess)
        try:
            site_checks.CACHE=self.d/'sites.json'
            def run(args,**kw):
                return types.SimpleNamespace(returncode=0,stdout='403 0.015') if 'bilibili' in args[-1] else types.SimpleNamespace(returncode=7,stdout='000 0.001')
            site_checks.subprocess=types.SimpleNamespace(run=run)
            result=site_checks.check();rows={x['id']:x for x in result['sites']}
            self.assertEqual(rows['bilibili']['status'],'limited');self.assertEqual(rows['youtube']['status'],'error')
            self.assertEqual(site_checks.snapshot()['time'],result['time'])
        finally:site_checks.CACHE,site_checks.subprocess=previous

@unittest.skipUnless(sys.platform.startswith('linux'),'OpenWrt runtime imports fcntl')
class RuntimeTests(FeatureTests):
    def scope(self):
        source=(ROOT/'files/etc/sb-router/manage').read_text(encoding='utf-8').split('\nmethods = ',1)[0]
        source=source.replace('LAN = lan_address()',"LAN = '192.0.2.1'").replace("pathlib.Path('/etc/sb-router')","pathlib.Path(TEST_DIR)")
        scope={'__name__':'feature_test','TEST_DIR':str(self.d)};exec(source,scope)
        return scope
    def store(self,name,value):
        (self.d/'profiles').mkdir(exist_ok=True);(self.d/'profiles'/(name+'.json')).write_text(json.dumps(value))
    def test_config_copy_is_independent_and_subscription_drop_adds_manual(self):
        s=self.scope();self.store('base',dict(base=True,nodes=[],subs=[]));self.store('source',dict(config=cfg(node('one'))));self.store('dest',dict(config=cfg(node('one'))))
        def profile(obj):return copy.deepcopy(obj.get('config',cfg(*obj.get('nodes',[]))))
        s['profile_config']=profile;s['validate_node']=lambda n:None
        s['write_profile']=lambda name,obj:s['save'](self.d/'profiles'/(name+'.json'),json.dumps(obj).encode())
        before=(self.d/'profiles/source.json').read_bytes()
        identity=s['node_key']('source','config','one')
        result=s['copy_nodes'](dict(ids=json.dumps([identity]),target='profile:dest',overwrite=False))
        self.assertEqual(result['count'],1);self.assertEqual((self.d/'profiles/source.json').read_bytes(),before)
        dest=json.loads((self.d/'profiles/dest.json').read_text());self.assertEqual(dest['copiedNodes'][0]['tag'],'one-copy-2');self.assertFalse(dest['copyOverwrite'])
        s['copy_nodes'](dict(ids=json.dumps([identity]),target='subscription:any',overwrite=False))
        base=json.loads((self.d/'profiles/base.json').read_text());self.assertEqual(base['nodes'][0]['tag'],'one');self.assertEqual(base['subs'],[])
    def test_update_preserves_copies_or_explicitly_allows_source_overwrite(self):
        s=self.scope();self.store('base',dict(base=True,nodes=[],subs=[]))
        self.store('remote',dict(url='https://provider.example/config',config=cfg(node('old')),copiedNodes=[node('extra')],copyOverwrite=False))
        s['fetch']=lambda url:json.dumps(cfg(node('fresh'))).encode();s['render']=lambda *a:None;s['active_name']=lambda:'none'
        s['update_selected'](['profile:remote'])
        obj=json.loads((self.d/'profiles/remote.json').read_text());self.assertEqual(obj['copiedNodes'][0]['tag'],'extra')
        obj['copyOverwrite']=True;self.store('remote',obj);s['update_selected'](['profile:remote'])
        self.assertNotIn('copiedNodes',json.loads((self.d/'profiles/remote.json').read_text()))
    def test_protected_copy_wins_same_name_source_update(self):
        s=self.scope();original=node('extra');incoming=node('extra');incoming['server']='new.example'
        merged=s['merge_copied'](cfg(incoming),[original])
        self.assertEqual(merged['outbounds'][0]['server'],'node.example')

    def test_parallel_profile_defaults_are_persisted_independently(self):
        import concurrent.futures
        names=['profile-'+str(i) for i in range(16)]
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results=list(pool.map(lambda name:profile_api.settings(self.d,name,{},'192.0.2.1'),names))
        saved=profile_api.read(self.d)
        self.assertEqual(set(saved),set(names));self.assertEqual(len({x['secret'] for x in results}),16)

    def test_existing_dashboard_helpers_refresh_without_downloading(self):
        import importlib.util
        spec=importlib.util.spec_from_file_location('sb_setup_test',ROOT/'files/etc/sb-router/setup.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);module.D=self.d
        helpers=self.d/'web-helpers';helpers.mkdir()
        for name in ['official-connect.js','luci-connect.js','luci-connect.html']:(helpers/name).write_text('new-helper')
        for name in module.PANELS:
            dest=self.d/'ui' if name=='official' else self.d/'panels'/name;dest.mkdir(parents=True);(dest/'index.html').write_text('<head><script src="./official-connect.js?v=old"></script></head>')
        module.panels();index=(self.d/'ui/index.html').read_text()
        self.assertEqual(index.count('official-connect.js'),1);self.assertIn('?v=1.9.1',index)
        self.assertEqual((self.d/'ui/official-connect.js').read_text(),'new-helper')
        self.assertEqual((self.d/'panels/yacd/luci-connect.js').read_text(),'new-helper')

    def test_batch_delete_applies_active_profile_only_once(self):
        s=self.scope();self.store('base',dict(base=True,nodes=[node('one'),node('two'),node('three')],subs=[]));original=s['profile_config']
        s['profile_config']=lambda obj:cfg(*obj.get('nodes',[])) if 'base' in obj else original(obj)
        s['render']=lambda *args:None;s['active_name']=lambda:'base';calls=[];s['install']=lambda *args:calls.append(args)
        ids=[s['node_key']('base','','one'),s['node_key']('base','','two')]
        result=s['delete_nodes_batch']({'ids':json.dumps(ids)});self.assertEqual(result['count'],2);self.assertEqual(len(calls),1)
        self.assertEqual([n['tag'] for n in s['read_obj']('base')['nodes']],['three'])
        before=(self.d/'profiles/base.json').read_bytes()
        with self.assertRaises(ValueError):s['delete_nodes_batch']({'ids':json.dumps([s['node_key']('base','','three')])})
        self.assertEqual((self.d/'profiles/base.json').read_bytes(),before)
    def test_batch_delete_rolls_back_every_source_when_activation_fails(self):
        s=self.scope();self.store('base',dict(base=True,nodes=[node('one'),node('two')],subs=[]));self.store('custom',dict(config=cfg(node('alpha'),node('beta'))));original=s['profile_config']
        s['profile_config']=lambda obj:cfg(*obj.get('nodes',[])) if 'base' in obj else original(obj)
        s['render']=lambda *args:None;s['active_name']=lambda:'custom'
        def fail(*a):raise RuntimeError('simulated startup failure')
        s['install']=fail;before={n:(self.d/'profiles'/(n+'.json')).read_bytes() for n in ['base','custom']}
        ids=[s['node_key']('base','','one'),s['node_key']('custom','config','alpha')]
        with self.assertRaises(RuntimeError):s['delete_nodes_batch']({'ids':json.dumps(ids)})
        for n,raw in before.items():self.assertEqual((self.d/'profiles'/(n+'.json')).read_bytes(),raw)

    def test_deferred_update_saves_source_but_leaves_running_file_untouched(self):
        s=self.scope();self.store('base',dict(base=True,nodes=[],subs=[]));self.store('remote',dict(url='https://provider.example/config',config=cfg(node('old'))))
        old=b'old-runtime';(self.d/'active.json').write_bytes(old);s['fetch']=lambda url:json.dumps(cfg(node('new'))).encode();s['render']=lambda *a:None;s['active_name']=lambda:'remote';calls=[];s['install']=lambda *a,**kw:calls.append(a)
        result=s['update_selected'](['profile:remote'],activate=False)
        self.assertTrue(result['deferred']);self.assertEqual(calls,[]);self.assertEqual((self.d/'active.json').read_bytes(),old);self.assertEqual(s['read_obj']('remote')['config']['outbounds'][0]['tag'],'new')
    def test_scheduled_updates_respect_latch_and_manual_updates_remain_explicit(self):
        import process_guard
        s=self.scope();process_guard.store(self.d,'backend',{'locked':True});s['update_items']=lambda:[{'id':'profile:remote'}]
        s['update_selected']=lambda chosen,activate=True:dict(activate=activate)
        self.assertFalse(s['action']('refresh-item',{'name':'profile:remote'.encode().hex()})['activate'])
        self.assertTrue(s['action']('item-update',{'id':'profile:remote'})['activate'])
    def test_failed_active_update_restores_source_file(self):
        s=self.scope();self.store('base',dict(base=True,nodes=[],subs=[]));self.store('remote',dict(url='https://provider.example/config',config=cfg(node('old'))))
        before=(self.d/'profiles/remote.json').read_bytes();s['fetch']=lambda url:json.dumps(cfg(node('new'))).encode();s['render']=lambda *a:None;s['active_name']=lambda:'remote'
        def fail(*a,**kw):raise RuntimeError('simulated failed startup')
        s['install']=fail
        with self.assertRaises(RuntimeError):s['update_selected'](['profile:remote'])
        self.assertEqual((self.d/'profiles/remote.json').read_bytes(),before)
    def test_failed_startup_restores_runtime_and_restarts_old_backend(self):
        s=self.scope();self.store('remote',dict(config=cfg(node('new'))));old=json.dumps(cfg(node('old'))).encode();(self.d/'active.json').write_bytes(old);(self.d/'selected').write_text('previous')
        def render(*a):
            p=self.d/'candidate.json';p.write_text(json.dumps(cfg(node('new'))));return p
        calls=[];s['render']=render;s['core_pid']=lambda:123;checks=iter([False,True]);s['wait_backend']=lambda pid:next(checks)
        s['sp']=types.SimpleNamespace(run=lambda args,**kw:calls.append(args),DEVNULL=subprocess.DEVNULL)
        with self.assertRaisesRegex(RuntimeError,'已恢复'):s['install']('remote',True,force=True)
        self.assertEqual((self.d/'active.json').read_bytes(),old);self.assertEqual((self.d/'selected').read_text(),'previous');self.assertEqual(len(calls),2)

if __name__=='__main__':unittest.main()
