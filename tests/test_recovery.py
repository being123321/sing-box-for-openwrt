import importlib.util,json,pathlib,subprocess,sys,tempfile,threading,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'files/etc/sb-router'))
import process_guard as guard
@unittest.skipUnless(sys.platform.startswith('linux'),'Requires POSIX worker process groups')
class RecoveryTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(dir=ROOT);self.d=pathlib.Path(self.tmp.name);guard.reset(self.d,'backend')
 def tearDown(self):self.tmp.cleanup()
 def test_three_automatic_failures_lock_and_manual_reset_is_required(self):
  notified=[];worker=guard.Supervisor(self.d,'backend',command=[sys.executable,'-c','raise SystemExit(7)'],stable_seconds=2,retry_delay=.01,health_check=lambda:True,on_locked=lambda:notified.append('restore-network'))
  self.assertEqual(worker.run(),1);state=guard.load(self.d,'backend')
  self.assertEqual(state['autoRestarts'],3);self.assertEqual(state['unexpectedExits'],4);self.assertTrue(state['locked']);self.assertEqual(notified,['restore-network'])
  second=guard.Supervisor(self.d,'backend',command=['/must-not-start'],on_locked=lambda:notified.append('again'));self.assertEqual(second.run(),1);self.assertEqual(notified,['restore-network'])
  guard.reset(self.d,'backend');self.assertFalse(guard.load(self.d,'backend')['locked'])
 def test_boot_does_not_clear_an_existing_failure_latch(self):
  state=guard.load(self.d,'backend');state['locked']=True;guard.store(self.d,'backend',state)
  self.assertFalse(guard.boot_allowed(self.d,'backend'));self.assertFalse(guard.boot_allowed(self.d,'tun'));self.assertTrue(guard.load(self.d,'backend')['locked'])
  guard.reset(self.d,'backend');self.assertTrue(guard.boot_allowed(self.d,'backend'))
  guard.store(self.d,'tun',{'locked':True});self.assertFalse(guard.boot_allowed(self.d,'tun'));self.assertTrue(guard.boot_allowed(self.d,'backend'))
 def test_normal_stop_does_not_count_as_an_unexpected_exit(self):
  worker=guard.Supervisor(self.d,'backend',command=[sys.executable,'-c','import time;time.sleep(8)'],stable_seconds=.05,health_check=lambda:True,on_locked=lambda:self.fail('must not trip'))
  timer=threading.Timer(.4,worker.stop);timer.start()
  try:self.assertEqual(worker.run(),0)
  finally:timer.cancel()
  state=guard.load(self.d,'backend');self.assertEqual(state['phase'],'stopped');self.assertEqual(state.get('unexpectedExits',0),0);self.assertEqual(state.get('autoRestarts',0),0)
 def test_successful_stable_recovery_clears_the_failure_attempt(self):
  program=self.d/'worker.py';counter=self.d/'counter'
  program.write_text('import pathlib,time,sys\np=pathlib.Path(sys.argv[1]);n=int(p.read_text()) if p.exists() else 0;p.write_text(str(n+1))\nif n==0:raise SystemExit(3)\ntime.sleep(8)\n')
  worker=guard.Supervisor(self.d,'backend',command=[sys.executable,str(program),str(counter)],stable_seconds=.05,retry_delay=.01,health_check=lambda:True,on_locked=lambda:self.fail('must recover'))
  timer=threading.Timer(.7,worker.stop);timer.start()
  try:worker.run()
  finally:timer.cancel()
  state=guard.load(self.d,'backend');self.assertEqual(state['autoRestarts'],1);self.assertEqual(state['attempt'],0);self.assertFalse(state['locked']);self.assertTrue(any(e['kind']=='stable' for e in state['events']))
 def test_old_worker_cannot_overwrite_new_manual_start_history(self):
  old=guard.Supervisor(self.d,'backend');guard.reset(self.d,'backend');generation=guard.load(self.d,'backend')['generation'];old.state['locked']=True;old.save()
  self.assertTrue(old.stopping);self.assertEqual(guard.load(self.d,'backend')['generation'],generation);self.assertFalse(guard.load(self.d,'backend')['locked'])
 def test_late_emergency_does_not_override_a_successful_manual_restart(self):
  source=(ROOT/'files/etc/sb-router/dns-hook').read_text().split("if __name__=='__main__':",1)[0]
  source=source.replace("D=pathlib.Path('/etc/sb-router')","D=pathlib.Path(TEST_DIR)")
  scope={'__name__':'dns_test','TEST_DIR':str(self.d)};exec(source,scope)
  scope['intent']=self.d/'wanted';scope['intent'].touch();scope['state']=self.d/'dns-before.json';calls=[];scope['fallback']=lambda reason:calls.append(reason)
  state=guard.load(self.d,'backend');state['locked']=True;guard.store(self.d,'backend',state);scope['emergency']();self.assertEqual(len(calls),1)
  guard.reset(self.d,'backend');scope['emergency']();self.assertEqual(len(calls),1)
if __name__=='__main__':unittest.main()
