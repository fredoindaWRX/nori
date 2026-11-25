import importlib.util
from pathlib import Path
import types
import unittest
from unittest.mock import patch


class HandInputOriginTests(unittest.TestCase):
    def load_worker(self):
        path = Path(__file__).resolve().parents[3] / 'apps/desktop/bridge/system_hand_input.py'
        spec = importlib.util.spec_from_file_location('hand_validation_fixture', path)
        module = importlib.util.module_from_spec(spec)
        with patch.dict('sys.modules', {'pyautogui': types.SimpleNamespace()}):
            spec.loader.exec_module(module)
        return module

    def test_input_rejects_coercion_nonfinite_and_unexpected_fields(self):
        worker = self.load_worker()
        self.assertEqual(worker.validate_input({'x': 0, 'y': 1, 'pinch': False}), (0.0, 1.0, False))
        for changes in ({'pinch': 'false'}, {'pinch': 1}, {'x': True}, {'x': '0.5'},
                        {'x': float('nan')}, {'y': float('inf')}, {'x': -0.1},
                        {'y': 1.1}, {'extra': 'field'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                worker.validate_input({'x': 0.5, 'y': 0.5, 'pinch': False, **changes})

    def test_repeated_pinch_updates_do_not_repeat_button_presses(self):
        worker = self.load_worker()
        events = []
        worker.desktop_bounds = lambda: (0, 0, 100, 100)
        worker.pyautogui = types.SimpleNamespace(
            size=lambda: (100, 100), moveTo=lambda *a, **k: events.append('move'),
            mouseDown=lambda **k: events.append('down'), mouseUp=lambda **k: events.append('up'))
        for pinch in (True, True, False, False):
            worker.apply_input(0.5, 0.5, pinch)
        self.assertEqual(events, ['move', 'down', 'move', 'move', 'up', 'move'])
        self.assertFalse(worker.down)

    def test_failed_mouse_press_does_not_record_held_button(self):
        worker = self.load_worker()
        worker.desktop_bounds = lambda: (0, 0, 100, 100)
        def fail(**kwargs):
            raise RuntimeError('controlled adapter failure')
        worker.pyautogui = types.SimpleNamespace(size=lambda: (100, 100), moveTo=lambda *a, **k: None, mouseDown=fail)
        with self.assertRaises(RuntimeError):
            worker.apply_input(0.5, 0.5, True)
        self.assertFalse(worker.down)

    def test_stale_tracking_releases_once_not_while_fresh(self):
        worker = self.load_worker()
        releases = []
        worker.pyautogui = types.SimpleNamespace(mouseUp=lambda **k: releases.append('up'))
        worker.down = True
        worker.last_input = 10.0
        worker.release_stale_input(now=10.5)
        self.assertTrue(worker.down)
        worker.release_stale_input(now=11.0)
        worker.release_stale_input(now=12.0)
        self.assertEqual(releases, ['up'])
        self.assertFalse(worker.down)

    def test_virtual_desktop_mapping_includes_negative_and_vertical_monitors(self):
        worker = self.load_worker()
        bounds = (-1920, -1080, 3840, 2160)
        self.assertEqual(worker.map_position(0, 0, bounds), (-1920, -1080))
        self.assertEqual(worker.map_position(1, 1, bounds), (1919, 1079))
        self.assertEqual(worker.map_position(0.5, 0.5, bounds), (0, 0))
        with self.assertRaises(ValueError):
            worker.map_position(0, 0, (0, 0, 0, 1080))

    def test_failed_release_remains_held_for_retry(self):
        worker = self.load_worker()
        worker.down = True
        def fail(**kwargs):
            raise RuntimeError('controlled release failure')
        worker.pyautogui = types.SimpleNamespace(mouseUp=fail)
        with self.assertRaises(RuntimeError):
            worker.release_held_input()
        self.assertTrue(worker.down)

    def test_foreign_origin_denied_before_mouse_or_body_read(self):
        path = Path(__file__).resolve().parents[3] / 'apps/desktop/bridge/system_hand_input.py'
        spec = importlib.util.spec_from_file_location('hand_origin_fixture', path)
        module = importlib.util.module_from_spec(spec)
        fake = types.SimpleNamespace()
        with patch.dict('sys.modules', {'pyautogui': fake}):
            spec.loader.exec_module(module)
        for method in ('do_POST', 'do_OPTIONS'):
            handler = object.__new__(module.Handler)
            handler.headers = {'Origin': 'https://untrusted.example'}
            module.control_key = 'a' * 48
            handler.headers['Authorization'] = 'Bearer ' + module.control_key
            codes = []
            handler._reply = codes.append
            getattr(handler, method)()
            self.assertEqual(codes, [403])

    def test_missing_or_wrong_key_denied_before_body_or_mouse(self):
        worker = self.load_worker()
        worker.control_key = 'a' * 48
        for value in ('', 'Bearer wrong', 'Bearer ' + 'b' * 48):
            with self.subTest(value=value):
                handler = object.__new__(worker.Handler)
                handler.headers = {'Origin': worker.origin, 'Authorization': value}
                codes = []
                handler._reply = codes.append
                # No body stream or mouse adapter exists in this fixture:
                # authorization must return before either can be accessed.
                handler.do_POST()
                self.assertEqual(codes, [401])

    def test_short_key_cannot_authorize_even_matching_header(self):
        worker = self.load_worker()
        for key in ('', 'short'):
            worker.control_key = key
            self.assertFalse(worker.authorized({'Authorization': 'Bearer ' + key}))
        worker.control_key = 'a' * 48
        self.assertTrue(worker.authorized({'Authorization': 'Bearer ' + worker.control_key}))


if __name__ == '__main__':
    unittest.main()
