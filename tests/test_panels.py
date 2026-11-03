import json
import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'files/etc/sb-router'))
import panel_registry


class PanelTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=ROOT)
        self.root = pathlib.Path(self.tmp.name)
        self.builtins = [dict(id='official', name='官方'), dict(id='custom', name='自定义')]

    def tearDown(self):
        self.tmp.cleanup()

    def link(self, pid, url):
        return url if pid.startswith('saved-') else 'http://192.0.2.1/dashboard/'

    def save(self, **arg):
        return panel_registry.update(self.root, self.builtins, self.link, arg)

    def test_bookmarks_survive_selection_and_address_edit(self):
        first = self.save(id='custom', name='我的面板', url='https://one.example/')
        second = self.save(id='custom', name='备用面板', url='https://two.example/')
        self.save(id='official')
        selected = self.save(id=first['id'])
        self.assertEqual(selected['name'], '我的面板')
        self.assertEqual(selected['url'], 'https://one.example/')
        edited = self.save(id=first['id'], name='新名称', url='https://new.example/')
        self.assertEqual(edited['id'], first['id'])
        reloaded = panel_registry.state(self.root, self.builtins, self.link)
        self.assertEqual(reloaded['name'], '新名称')
        self.assertEqual(len([x for x in reloaded['panels'] if x['id'].startswith('saved-')]), 2)
        self.assertIn(second['id'], [x['id'] for x in reloaded['panels']])

    def test_same_name_updates_without_duplicate(self):
        first = self.save(id='custom', name='Dashboard', url='https://one.example/')
        second = self.save(id='custom', name='dashboard', url='https://two.example/')
        self.assertEqual(first['id'], second['id'])
        self.assertEqual(second['url'], 'https://two.example/')
        self.assertEqual(len(second['panels']), 3)

    def test_legacy_address_migrates_and_invalid_edits_do_not_commit(self):
        (self.root / 'panel.json').write_text(json.dumps(dict(id='custom', url='https://old.example/')))
        state = panel_registry.state(self.root, self.builtins, self.link)
        self.assertEqual(state['name'], '我的面板')
        saved = self.save(id=state['id'])
        before = (self.root / 'panel.json').read_bytes()
        for value in ['javascript:alert(1)', 'https://u:p@example.com', 'https://example.com:99999', 'https://example.com/\n']:
            # Surrounding whitespace is intentionally accepted, embedded controls are not.
            if value.endswith('\n'):
                value = 'https://example.com/a\nb'
            with self.assertRaises(ValueError):
                self.save(id=saved['id'], name='我的面板', url=value)
            self.assertEqual((self.root / 'panel.json').read_bytes(), before)


if __name__ == '__main__':
    unittest.main()

