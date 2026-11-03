import io,json,pathlib,sys,types,unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'files/etc/sb-router'))
import telemetry

class TotalTests(unittest.TestCase):
    def read(self,data):
        platform=types.SimpleNamespace(api_url=lambda path:'http://127.0.0.1:9090'+path,api_secret=lambda:'fixture')
        with patch.dict(sys.modules,router_platform=platform),patch('urllib.request.urlopen',return_value=io.BytesIO(json.dumps(data).encode())):
            return telemetry.core_totals()
    def test_real_total_fields_preserve_zero_and_large_values(self):
        self.assertEqual(self.read({'uploadTotal':0,'downloadTotal':307795233}),{'uploadTotal':0,'downloadTotal':307795233})
    def test_missing_totals_are_unavailable_not_false_zero(self):
        self.assertEqual(self.read({'uploadTotal':None,'downloadTotal':-1}),{})
    def test_offline_core_does_not_break_system_statistics(self):
        platform=types.SimpleNamespace(api_url=lambda path:'http://127.0.0.1:9090'+path,api_secret=lambda:'fixture')
        with patch.dict(sys.modules,router_platform=platform),patch('urllib.request.urlopen',side_effect=OSError('offline')):
            self.assertEqual(telemetry.core_totals(),{})

if __name__=='__main__':unittest.main()
