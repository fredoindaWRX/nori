"""Plugin metadata admission; execution remains denied without isolation."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'nori/shared'))
from orchestration.trinity_worker import TrinityWorker
from permissions.nori_policy import Policy


class PluginAdmissionTests(unittest.TestCase):
    def test_denied_policy_never_reads_plugin_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            worker=TrinityWorker(Path(directory)/'plugins',Policy([]),Path(directory)/'audit.jsonl')
            with patch.object(worker,'_plugin',side_effect=AssertionError('Metadata must not be read')):
                self.assertEqual(worker.invoke('fixture',{})['status'],'denied')
                self.assertEqual(worker.list()['status'],'denied')

    def test_manifest_growth_is_refused_despite_small_initial_stat(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'plugins'
            plugin=root/'fixture'
            plugin.mkdir(parents=True)
            manifest=plugin/'nori-plugin.json'
            manifest.write_bytes(b'x'*(16*1024+1))
            (plugin/'plugin.py').write_text('pass',encoding='utf-8')
            worker=TrinityWorker(root,Policy(['plugin_execute']),Path(directory)/'audit.jsonl')
            original_stat=Path.stat
            def small_stat(path,*args,**kwargs):
                result=original_stat(path,*args,**kwargs)
                if path==manifest:
                    class SmallStat:
                        st_size=1
                        def __getattr__(self,name):return getattr(result,name)
                    return SmallStat()
                return result
            with patch.object(Path,'stat',small_stat):
                with self.assertRaisesRegex(ValueError,'grew beyond'):
                    worker._plugin('fixture')
