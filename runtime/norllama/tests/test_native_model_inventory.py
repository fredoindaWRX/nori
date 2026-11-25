"""Native public model inspection refuses mismatched runtime evidence."""
import sys
from pathlib import Path
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from core_client import NativeInferenceClient,NativeInferenceError


class InventoryTests(unittest.TestCase):
    def test_preflight_only_checks_resident_model_and_never_loads(self):
        client=NativeInferenceClient('http://127.0.0.1:1','x'*32,'fixture')
        with patch.object(client,'_request',side_effect=AssertionError('Must not load a model')):
            result=client.preflight('other-model')
            self.assertEqual(result['status'],'unsupported')
            self.assertFalse(result['ready'])
            self.assertFalse(result['model_changed'])
        with patch.object(client,'health',return_value={'ready':True,'model_id':'fixture','backend':'norama-independent'}),patch.object(client,'models',return_value={'models':[{'provenance':'imported'}]}):
            result=client.preflight('fixture')
            self.assertTrue(result['ready'])
            self.assertFalse(result['assistant_qualified'])
            self.assertEqual(result['inspection_scope'],'resident_model_only')
        with patch.object(client,'health',side_effect=NativeInferenceError('not ready')):
            with self.assertRaises(NativeInferenceError):client.preflight('fixture')

    def test_inventory_checks_identity_and_excludes_unapproved_fields(self):
        client=NativeInferenceClient('http://127.0.0.1:1','x'*32,'fixture')
        model={'id':'fixture','backend':'norama-independent','provenance':'imported',
               'assistant_qualified':False,'extra_private_field':'synthetic-not-returned'}
        with patch.object(client,'_request',return_value={'models':[model]}):
            result=client.models()
            self.assertNotIn('extra_private_field',result['models'][0])
        for changes in [{'id':'wrong'},{'backend':'ollama'},{'provenance':'unknown'},{'assistant_qualified':True}]:
            with self.subTest(changes=changes),patch.object(client,'_request',return_value={'models':[{**model,**changes}]}):
                with self.assertRaises(NativeInferenceError):client.models()
        for models in [None,[],[model,model],['bad']]:
            with self.subTest(models=models),patch.object(client,'_request',return_value={'models':models}):
                with self.assertRaises(NativeInferenceError):client.models()
