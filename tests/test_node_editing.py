import copy,json,pathlib,sys,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'files/etc/sb-router'))
import node_edits

def node(tag='A',server='old.example'):
    return dict(type='hysteria2',tag=tag,server=server,server_port=443,password='fixture',tls={'enabled':True})
def cfg(*nodes):
    return {'outbounds':list(nodes)+[{'type':'selector','tag':'PROXY','outbounds':[n['tag'] for n in nodes]}]}

class PureTests(unittest.TestCase):
    def test_certificate_only_false_unset_and_parameters(self):
        old=node();new=copy.deepcopy(old);new['tls']['insecure']=True
        self.assertEqual(node_edits.kind(old,new),'certificate')
        new['tls']['insecure']=False;self.assertEqual(node_edits.kind(old,new),'unchanged')
        new['server']='other.example';self.assertEqual(node_edits.kind(old,new),'parameters')
    def test_suffix_unique_and_does_not_mutate_input(self):
        original=node();saved=node_edits.local_copy(original,{'A-本地修改','A-本地修改-2'})
        self.assertEqual(saved['tag'],'A-本地修改-3');self.assertEqual(original['tag'],'A')
    def test_tls_patch_preserves_provider_changes_and_false(self):
        new=node(server='new.example');new['password']='changed'
        patched=node_edits.patch_tls(new,{'A':False})
        self.assertFalse(patched['tls']['insecure']);self.assertEqual(patched['password'],'changed');self.assertNotIn('insecure',new['tls'])

@unittest.skipUnless(sys.platform.startswith('linux'),'OpenWrt management runtime')
class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir=ROOT);self.d=pathlib.Path(self.tmp.name)
        source=(ROOT/'files/etc/sb-router/manage').read_text(encoding='utf-8').split('\nmethods = ',1)[0]
        source=source.replace('LAN = lan_address()',"LAN = '192.0.2.1'").replace("pathlib.Path('/etc/sb-router')","pathlib.Path(TEST_DIR)")
        self.s={'__name__':'node_test','TEST_DIR':str(self.d)};exec(source,self.s)
        self.s['check']=lambda c:None;self.s['render']=lambda *args:None;self.s['base_mode']=lambda:'cn'
        self.s['base_config']=lambda nodes,mode:cfg(*copy.deepcopy(nodes))
        self.store('base',{'base':True,'nodes':[node('Manual')],'subs':[]})
    def tearDown(self):self.tmp.cleanup()
    def store(self,name,obj):
        (self.d/'profiles'/(name+'.json')).write_text(json.dumps(obj))
    def read(self,name):return json.loads((self.d/'profiles'/(name+'.json')).read_text())
    def save(self,name,old,new):return self.s['node_set'](name,old,json.dumps(new))
    def effective(self,name):return self.s['profile_config'](self.read(name))
    def test_manual_and_local_profile_edit_directly_and_reject_duplicates(self):
        new=node('Manual');new['server']='local.example'
        entry=self.s['catalog']()[0];result=self.s['change_catalog']({'id':entry['id'],'value':json.dumps(new)})
        self.assertEqual(result['editKind'],'local');self.assertEqual(self.read('base')['nodes'][0]['tag'],'Manual')
        self.store('local',{'config':cfg(node(),node('B'))});new=node();new['server']='local.example'
        result=self.save('local','A',new);self.assertEqual(result['editKind'],'local');self.assertEqual(self.effective('local')['outbounds'][0]['server'],'local.example')
        new['tag']='B'
        with self.assertRaises(ValueError):self.save('local','A',new)
    def test_remote_tls_updates_only_flag_and_legacy_certificate_migrates(self):
        old=node();legacy=copy.deepcopy(old);legacy['tls']['insecure']=True
        self.store('remote',{'url':'https://example.test/sub','config':cfg(old),'nodeOverrides':{'A':legacy}})
        fresh=node(server='new.example');fresh['password']='provider-new'
        self.s['fetch']=lambda *a,**kw:json.dumps(cfg(fresh)).encode()
        result=self.s['update_selected'](['profile:remote'],activate=False);self.assertTrue(result['ok'])
        current=self.effective('remote')['outbounds'][0]
        self.assertTrue(current['tls']['insecure']);self.assertEqual(current['server'],'new.example');self.assertEqual(current['password'],'provider-new')
        current['tls']['insecure']=False;result=self.save('remote','A',current)
        self.assertEqual(result['editKind'],'certificate');self.assertEqual(result['tag'],'A')
        self.s['update_selected'](['profile:remote'],activate=False)
        self.assertFalse(self.effective('remote')['outbounds'][0]['tls']['insecure'])
    def test_remote_parameter_copy_survives_overwrite_update_and_can_edit_delete(self):
        self.store('remote',{'url':'https://example.test/sub','config':cfg(node()),'copyOverwrite':True})
        edited=node();edited['server']='mine.example';result=self.save('remote','A',edited)
        tag=result['tag'];self.assertTrue(tag.endswith('-本地修改'));self.assertFalse(result['updateWillOverwrite'])
        self.s['fetch']=lambda *a,**kw:json.dumps(cfg(node(server='provider.example'))).encode()
        self.assertTrue(self.s['update_selected'](['profile:remote'],activate=False)['ok'])
        nodes={n['tag']:n for n in self.effective('remote')['outbounds']}
        self.assertEqual(nodes['A']['server'],'provider.example');self.assertEqual(nodes[tag]['server'],'mine.example')
        edited=copy.deepcopy(nodes[tag]);edited['server']='mine2.example'
        self.assertEqual(self.save('remote',tag,edited)['editKind'],'local')
        self.assertEqual(len(self.read('remote')['localNodes']),1)
        self.s['node_del']('remote',tag)
        self.assertNotIn(tag,{n['tag'] for n in self.effective('remote')['outbounds']})
    def test_base_subscription_tls_and_parameter_copy_survive_refresh(self):
        obj=self.read('base');obj['subs']=[{'name':'airport','url':'https://example.test/sub','nodes':[node()]}];self.store('base',obj)
        entry=next(e for e in self.s['catalog']() if e['source']=='airport');edited=copy.deepcopy(entry['node']);edited['tls']['insecure']=True
        result=self.s['change_catalog']({'id':entry['id'],'value':json.dumps(edited)});self.assertEqual(result['editKind'],'certificate')
        edited['server']='mine.example';result=self.s['change_catalog']({'id':entry['id'],'value':json.dumps(edited)})
        self.assertEqual(result['editKind'],'parameters');copy_tag=result['tag']
        self.s['fetch']=lambda *a,**kw:json.dumps(cfg(node(server='new.example'))).encode()
        self.s['sub_parse']=lambda raw:[node(server='new.example')]
        self.assertTrue(self.s['update_selected'](['sub:airport'],activate=False)['ok'])
        entries={x['node']['tag']:x['node'] for x in self.s['catalog']()}
        self.assertTrue(entries['A']['tls']['insecure']);self.assertEqual(entries['A']['server'],'new.example');self.assertEqual(entries[copy_tag]['server'],'mine.example')
    def test_node_subscription_local_copy_is_not_dropped_by_refresh(self):
        self.store('sub',{'suburl':'https://example.test/nodes','nodes':[node()]})
        edited=node();edited['password']='mine';result=self.save('sub','A',edited)
        self.s['fetch']=lambda *a,**kw:b'fixture';self.s['sub_parse']=lambda raw:[node(server='updated.example')]
        self.s['update_selected'](['profile:sub'],activate=False)
        nodes={x['tag']:x for x in self.effective('sub')['outbounds']}
        self.assertEqual(nodes[result['tag']]['password'],'mine');self.assertEqual(nodes['A']['server'],'updated.example')
    def test_batch_delete_protected_copy_does_not_reappear(self):
        self.store('remote',{'url':'https://example.test/sub','config':cfg(node())})
        edited=node();edited['server']='mine.example';tag=self.save('remote','A',edited)['tag']
        entry=next(e for e in self.s['config_entries']() if e['node']['tag']==tag)
        self.s['delete_nodes_batch']({'ids':json.dumps([entry['id']])})
        self.assertNotIn(tag,{n['tag'] for n in self.effective('remote')['outbounds']})

if __name__=='__main__':unittest.main()
