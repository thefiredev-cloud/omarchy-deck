import importlib.machinery
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/deck-feed-serverpage'
PRIVATE = {'subject': 'PRIVATE_SUBJECT', 'sender': 'PRIVATE_SENDER', 'thread_id': 'PRIVATE_THREAD',
           'prompt': 'PRIVATE_PROMPT', 'body': 'PRIVATE_BODY', 'token': 'PRIVATE_TOKEN'}


class ServerPagePrivacy(unittest.TestCase):
    def setUp(self):
        loader = importlib.machinery.SourceFileLoader('sp_privacy', str(SCRIPT))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        self.c = importlib.util.module_from_spec(spec)
        loader.exec_module(self.c)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.c.HOME = Path(self.tmp.name)

    def save(self, rel, doc):
        path = self.c.HOME / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(doc))
        return path

    def test_gateway_is_unauthenticated_loopback_health_and_never_opens_env(self):
        self.save('.hermes/.env', 'API_SERVER_KEY=PRIVATE_TOKEN')
        seen = []
        real_open = Path.open
        def guarded(path, *args, **kwargs):
            self.assertNotEqual(path.name, '.env', 'collector must not open credentials')
            return real_open(path, *args, **kwargs)
        def health(request, **kwargs):
            seen.append(request)
            return io.StringIO(json.dumps({'status': 'ok', 'platforms': PRIVATE, 'readiness': PRIVATE}))
        with mock.patch.object(Path, 'open', guarded), mock.patch.object(self.c.urllib.request, 'urlopen', side_effect=health), \
             mock.patch.object(self.c, 'unit_props', return_value={'NRestarts': '0'}):
            result = self.c.gateway()
        self.assertTrue(result['ok'])
        self.assertEqual(seen[0].full_url, 'http://127.0.0.1:8642/health')
        self.assertFalse(seen[0].headers)
        self.assertNotIn('PRIVATE_', json.dumps(result))
        self.assertIsNone(result['platforms_up'])

    def test_sensitive_inputs_are_projected_before_python_decodes_them(self):
        self.save('.meshvault/status/deck/replyblock.json', {'date': '2030-01-01', 'card_for': '09:00', 'counts': PRIVATE, 'items': [PRIVATE], **PRIVATE})
        self.save('.hermes/cron/jobs.json', {'jobs': [{'name': 'Mail follow-up', 'schedule': '0 9 * * *',
                  'next_run_at': '2030-01-01T10:00:00Z', 'last_status': 'ok', 'enabled': True, 'state': 'scheduled', **PRIVATE}]})
        # Raw private JSON must not reach json.load/json.loads in the collector process.
        original_loads = json.loads
        def restricted(text, *args, **kwargs):
            self.assertNotIn('PRIVATE_', str(text))
            self.assertNotIn('"enabled"', str(text))
            self.assertNotIn('"state"', str(text))
            return original_loads(text, *args, **kwargs)
        with mock.patch.object(self.c.json, 'loads', side_effect=restricted), \
             mock.patch.object(self.c, 'unit_props', return_value={'LoadState': 'not-found'}):
            result = self.c.mail({})
        self.assertEqual(len(result['items']), 2)
        self.assertNotIn('PRIVATE_', json.dumps(result))
        self.assertNotIn('paused_mail_crons', result)

    def test_retained_legacy_rows_drop_private_fields(self):
        old = {'next': {'name': 'Mail follow-up', 'at': 1900000000, 'kind': 'cron', **PRIVATE},
               'items': [{'name': 'Mail follow-up', 'at': 1900000000, 'kind': 'cron', **PRIVATE}],
               'read_at': 1800000000, 'gmail': {'count': 42}, **PRIVATE}
        with mock.patch.object(self.c, 'unit_props', side_effect=OSError('offline')):
            result = self.c.mail(old)
        self.assertTrue(result['stale'])
        self.assertNotIn('PRIVATE_', json.dumps(result))
        self.assertNotIn('gmail', result)
