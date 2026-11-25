import unittest
import tempfile
import importlib.util
import shutil
from unittest.mock import patch
from pathlib import Path
from nori.self_development import normalize_queued_task, prepare_local_task, stage_queued_local_tasks, LEGACY_WORKERS
from nori.workspace_operator import DEFAULT_ROOT, DEFAULT_LOCAL_WORKERS, create_workspace_task, operator_status


class NativeSelfDevelopmentTests(unittest.TestCase):
    def test_roadmap_presence_never_claims_execution_ready(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for present in (False, True):
                if present:
                    (root / 'ROADMAP_TRACKING.json').write_text('{}', encoding='utf-8')
                result = operator_status(root)
                self.assertEqual(result['roadmap_available'], present)
                self.assertTrue(result['task_intake_available'])
                self.assertFalse(result['ready'])
                self.assertFalse(result['execution_qualified'])

    def test_operator_root_follows_relocated_source_not_development_checkout(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / 'transferred-suite' / 'nori' / 'workspace_operator.py'
            destination.parent.mkdir(parents=True)
            shutil.copyfile(DEFAULT_ROOT / 'nori' / 'workspace_operator.py', destination)
            spec = importlib.util.spec_from_file_location('relocated_nori_operator_fixture', destination)
            module = importlib.util.module_from_spec(spec)
            import sys
            sys.modules[spec.name] = module
            try:
                spec.loader.exec_module(module)
                self.assertEqual(module.DEFAULT_ROOT, destination.parent.parent)
                task = module.create_workspace_task('Inspect local code')
                self.assertEqual(task['project_root'], str(destination.parent.parent))
                self.assertNotEqual(module.DEFAULT_ROOT, DEFAULT_ROOT)
            finally:
                sys.modules.pop(spec.name, None)

    def test_new_task_names_native_knights_without_enabling_hosted_workers(self):
        task = create_workspace_task('Inspect Nori code')
        self.assertEqual(tuple(task['workers']), DEFAULT_LOCAL_WORKERS)
        self.assertTrue(task['local_only'])
        self.assertFalse(task['allow_hosted_escalation'])

    def test_legacy_queue_migrates_in_memory_without_rewriting_original(self):
        task = {'task_id': 'nori-task-fixture', 'request': 'Inspect Nori code',
                'project_root': 'C:\\Cortana', 'workers': list(LEGACY_WORKERS)}
        result = normalize_queued_task(task)
        self.assertEqual(result['workers'], list(DEFAULT_LOCAL_WORKERS))
        self.assertEqual(task['workers'], list(LEGACY_WORKERS))
        self.assertFalse(result['allow_hosted_escalation'])

    def test_unknown_worker_refused_not_silently_dispatched(self):
        task = {'task_id': 'nori-task-fixture', 'request': 'Inspect Nori code',
                'project_root': 'C:\\Nori', 'workers': ['external_cli']}
        with self.assertRaises(ValueError):
            normalize_queued_task(task)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                prepare_local_task(task, runs_dir=Path(directory))
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_packet_has_native_sequence_but_never_deployment_authority(self):
        task = create_workspace_task('Inspect Nori code')
        with tempfile.TemporaryDirectory() as directory:
            result = prepare_local_task(task, runs_dir=Path(directory))
            self.assertEqual([row['worker'] for row in result['worker_sequence']], list(DEFAULT_LOCAL_WORKERS))
            self.assertFalse(result['deployment']['live_changes_allowed'])
            self.assertFalse(result['deployment']['requested'])

    def test_existing_partial_packet_never_overwritten_by_direct_or_queue_prepare(self):
        import json
        task = create_workspace_task('Inspect Nori code')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / 'runs' / task['task_id']
            target.mkdir(parents=True)
            packet = target / 'work_packet.json'
            original = b'{"status":"prepared","completion_evidence":[]}'
            packet.write_bytes(original)
            with self.assertRaises(FileExistsError):
                prepare_local_task(task, runs_dir=root / 'runs')
            queue = root / 'queue.jsonl'
            queue.write_text(json.dumps({'task':task}) + '\n', encoding='utf-8')
            self.assertEqual(stage_queued_local_tasks(task_file=queue, runs_dir=root / 'runs'), [])
            self.assertEqual(packet.read_bytes(), original)

    def test_invalid_later_queue_row_creates_no_earlier_packet(self):
        import json
        task = create_workspace_task('Inspect Nori code')
        for invalid in ('not JSON', '{"task":{},"task":{}}', '{"value":NaN}',
                        'x' * 65537):
            with self.subTest(invalid=invalid[:30]), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                queue = root / 'queue.jsonl'
                queue.write_text(json.dumps({'task':task}) + '\n' + invalid, encoding='utf-8')
                with self.assertRaises(ValueError):
                    stage_queued_local_tasks(task_file=queue, runs_dir=root / 'runs')
                self.assertFalse((root / 'runs').exists())

    def test_queue_total_bytes_and_row_count_are_bounded_before_storage(self):
        for name, limit, content in (('MAX_QUEUE_BYTES', 8, b'x' * 9),
                                     ('MAX_QUEUE_ROWS', 1, b'{}\n{}\n')):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                queue = root / 'queue.jsonl'
                queue.write_bytes(content)
                with patch('nori.self_development.' + name, limit), self.assertRaises(ValueError):
                    stage_queued_local_tasks(task_file=queue, runs_dir=root / 'runs')
                self.assertFalse((root / 'runs').exists())


if __name__ == '__main__':
    unittest.main()
