import ast,base64,json,pathlib,sys,tempfile,time,unittest,types,urllib.parse
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'files/etc/sb-router'))
import quota_labels,subscription_usage as usage,usage_refresh

class QuotaTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir=ROOT);self.root=pathlib.Path(self.tmp.name)
        (self.root/'profiles').mkdir();(self.root/'selected').write_text('airport')
    def tearDown(self):self.tmp.cleanup()
    def profile(self,name,value):
        (self.root/'profiles'/(name+'.json')).write_text(json.dumps(value))
    def test_group_only_quota_and_expiry_from_supported_formats(self):
        data={'outbounds':[{'tag':'剩余流量：12.5 GB'},{'tag':'套餐到期：2026-12-31'}]}
        result=quota_labels.extract(data)
        self.assertEqual(result['remaining'],12500000000);self.assertEqual(result['expireText'],'2026-12-31')
        self.assertNotIn('used',result);self.assertNotIn('total',result)
        text='hy2://secret@example.com:443#%E5%89%A9%E4%BD%99%E6%B5%81%E9%87%8F%3A%202%20GiB'
        self.assertEqual(quota_labels.extract(base64.b64encode(text.encode()))['remaining'],2147483648)
        self.assertFalse(quota_labels.extract({'password':'剩余流量：999 GB','server':'expiry.example'}))
    def test_header_priority_missing_data_and_cooldown_survive_local_reads(self):
        url='https://example.test/sub'
        usage.record(self.root,url,'Subscription-Userinfo: upload=20; download=80; total=1000; expire=1800000000','{"outbounds":[{"tag":"剩余流量: 3 GB"}]}'.encode())
        usage.record_groups(self.root,url,{'nodes':[{'tag':'剩余流量: 9 GB'}]})
        self.assertEqual(usage.info(self.root,url)['remaining'],900)
        usage.record(self.root,url,'HTTP/2 200')
        self.assertTrue(usage.info(self.root,url)['provided']);self.assertTrue(usage.info(self.root,url)['stale'])
        usage.rate_limit(self.root,url,429,'Retry-After: 1200')
        usage.record_groups(self.root,url,{'nodes':[{'tag':'剩余流量: 9 GB'}]})
        with self.assertRaises(ValueError):usage.check_fetch(self.root,url)
        self.assertEqual(usage.info(self.root,url)['remaining'],900)
        usage.record(self.root,url,'HTTP/2 200','{"outbounds":[{"tag":"剩余流量: 8 GB"}]}'.encode())
        usage.check_fetch(self.root,url)
        self.assertEqual(usage.info(self.root,url)['remaining'],8000000000)
    def test_running_interval_stop_cache_and_provider_isolation(self):
        self.profile('airport',{'url':'https://example.test/a','config':{'outbounds':[{'tag':'剩余流量：4 GB'}]}})
        self.profile('base',{'base':True,'subs':[{'name':'other','url':'https://example.test/b','nodes':[]}]})
        reads=[]
        def live():reads.append(1);return {'proxies':{'到期：2026-12-31':{'name':'到期：2026-12-31'}}}
        first=usage_refresh.refresh(self.root,running=True,read_runtime=live,now=1000)
        self.assertEqual(len(reads),1);self.assertFalse(first['skipped'])
        self.assertEqual(usage.info(self.root,'https://example.test/a')['expireText'],'2026-12-31')
        self.assertFalse(usage.info(self.root,'https://example.test/b')['provided'])
        self.assertTrue(usage_refresh.refresh(self.root,running=True,read_runtime=live,now=1200)['skipped'])
        before=(self.root/'subscription-usage.json').read_bytes()
        self.assertTrue(usage_refresh.refresh(self.root,running=False,force=True,read_runtime=live,now=1500)['skipped'])
        self.assertEqual((self.root/'subscription-usage.json').read_bytes(),before);self.assertEqual(len(reads),1)
        usage_refresh.refresh(self.root,running=True,read_runtime=live,now=1501)
        self.assertEqual(len(reads),2)
    def test_group_refresh_preserves_backoff(self):
        url='https://example.test/sub';body={'nodes':[{'tag':'剩余流量: 8 GB'}]}
        usage.record_groups(self.root,url,body);usage.rate_limit(self.root,url,403,'')
        usage.record_groups(self.root,url,body)
        with self.assertRaises(ValueError):usage.check_fetch(self.root,url)
    def test_cron_install_is_idempotent_and_preserves_other_jobs(self):
        saved=[]
        def run(args,**kw):
            if args==['crontab','-l']:return type('Result',(),{'stdout':'1 2 * * * other-job\n*/5 * * * * old # sb-router-usage\n'})()
            saved.append(kw['input'].decode())
        with patch.object(usage_refresh.subprocess,'run',side_effect=run):usage_refresh.ensure_cron()
        self.assertEqual(saved[0].count('# sb-router-usage'),1);self.assertIn('other-job',saved[0])
    def test_manual_fetch_updates_group_quota_and_avoids_retrying_rate_limit(self):
        source=ast.parse((ROOT/'files/etc/sb-router/manage').read_text(encoding='utf-8'))
        function=next(x for x in source.body if isinstance(x,ast.FunctionDef) and x.name=='fetch')
        requests=[];rate_limited=[False]
        def run(args,**kw):
            requests.append(args)
            pathlib.Path(args[args.index('-D')+1]).write_text('HTTP/2 429\nRetry-After: 1800\n' if rate_limited[0] else 'HTTP/2 200\n')
            pathlib.Path(args[args.index('-o')+1]).write_text('{"outbounds":[{"tag":"剩余流量: 5 GB"}]}',encoding='utf-8')
            return types.SimpleNamespace(returncode=22 if rate_limited[0] else 0,stdout=b'429' if rate_limited[0] else b'200')
        scope={'D':self.root,'urllib':urllib,'pathlib':pathlib,'tempfile':types.SimpleNamespace(TemporaryDirectory=lambda **kw:tempfile.TemporaryDirectory(dir=ROOT,**kw)),'sp':types.SimpleNamespace(run=run)}
        exec(compile(ast.Module(body=[function],type_ignores=[]),'fetch-test','exec'),scope)
        scope['fetch']('https://example.test/sub')
        self.assertEqual(usage.info(self.root,'https://example.test/sub')['remaining'],5000000000)
        self.assertEqual(requests[-1][requests[-1].index('--max-time')+1],'180')
        rate_limited[0]=True
        with self.assertRaises(ValueError):scope['fetch']('https://example.test/sub')
        self.assertEqual(len(requests),2)
        with self.assertRaises(ValueError):scope['fetch']('https://example.test/sub')
        self.assertEqual(len(requests),2)

if __name__=='__main__':unittest.main()
