import importlib.machinery
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/deck-feed-serverpage'


class ServerPageFeed(unittest.TestCase):
    def setUp(self):
        if not SCRIPT.exists():
            self.fail('server page collector is missing on main')
        loader = importlib.machinery.SourceFileLoader('serverpage', str(SCRIPT))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        self.c = importlib.util.module_from_spec(spec)
        loader.exec_module(self.c)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.c.HOME = Path(self.tmp.name)

    def test_no_gmail_or_composio_read_and_missing_counts_are_null(self):
        source = SCRIPT.read_text()
        self.assertNotIn('gmail.googleapis.com', source)
        self.assertNotIn('composio', source.lower())
        with mock.patch.object(self.c.urllib.request, 'urlopen', side_effect=OSError('not reporting')):
            g = self.c.gateway()
        self.assertIsNone(g['ok'])
        self.assertIsNone(g['platforms_up'])
        self.assertIsNone(g['restarts'])
        self.assertTrue(g['reason'])

    def test_mail_partial_failure_keeps_old_rows_marked_out_of_date(self):
        old = {'next': {'name': 'Keep reply block', 'at': 1900000000, 'kind': 'send'},
               'items': [{'name': 'Keep reply block', 'at': 1900000000, 'kind': 'send'}],
               'paused_mail_crons': 2, 'read_at': 1800000000, 'gmail': {'count': 99}}
        with mock.patch.object(self.c, 'unit_props', side_effect=OSError('no manager')):
            m = self.c.mail(old)
        self.assertEqual(m['items'], old['items'])
        self.assertEqual(m['read_at'], old['read_at'])
        self.assertTrue(m['stale'])
        self.assertTrue(m['reason'])
        self.assertNotIn('gmail', m)

    def test_no_reply_block_rollover_invents_a_tomorrow_send(self):
        root = self.c.HOME
        rb = root / '.meshvault/status/deck/replyblock.json'
        rb.parent.mkdir(parents=True)
        rb.write_text(json.dumps({'date': '2020-01-01', 'card_for': '09:00'}))
        jobs = root / '.hermes/cron/jobs.json'
        jobs.parent.mkdir(parents=True)
        jobs.write_text(json.dumps({'jobs': []}))
        with mock.patch.object(self.c, 'unit_props', return_value={'LoadState': 'not-found'}):
            m = self.c.mail({})
        self.assertEqual(m['items'], [])
        self.assertIsNone(m['next'])
        self.assertNotIn('reason', m)

    def test_unreadable_cron_next_run_retains_last_good_rows_and_reason(self):
        root = self.c.HOME
        rb = root / '.meshvault/status/deck/replyblock.json'
        rb.parent.mkdir(parents=True)
        rb.write_text(json.dumps({'date': '2020-01-01', 'card_for': '09:00'}))
        jobs = root / '.hermes/cron/jobs.json'
        jobs.parent.mkdir(parents=True)
        old_row = {'name': 'Mail follow-up', 'at': 1900000000, 'kind': 'cron'}
        old = {'next': old_row, 'items': [old_row], 'read_at': 1800000000}
        for bad_time in ('not-a-time', None, False, {}):
            with self.subTest(next_run_at=bad_time):
                jobs.write_text(json.dumps({'jobs': [{'name': 'Mail follow-up', 'next_run_at': bad_time, 'last_status': 'ok'}]}))
                with mock.patch.object(self.c, 'unit_props', return_value={'LoadState': 'not-found'}):
                    result = self.c.mail(old)
                self.assertEqual(result['items'], old['items'], 'an unreadable next run must not erase the last row')
                self.assertEqual(result['next'], old['next'])
                self.assertEqual(result['read_at'], old['read_at'])
                self.assertTrue(result['stale'])
                self.assertIn('next run time unreadable', result['reason'])

    def test_atomic_staged_write_is_private_and_keeps_failure_reason(self):
        with mock.patch.object(self.c, 'gateway', return_value={'ok': None, 'state': 'unknown', 'reason': 'missing key'}), \
             mock.patch.object(self.c, 'mail', return_value={'next': None, 'items': [], 'reason': 'no scheduler'}):
            self.c.main()
        p = self.c.HOME / '.meshvault/status/deck/serverpage.json'
        d = json.loads(p.read_text())
        self.assertEqual(d['refresh'], 120)
        self.assertEqual(d['gateway']['reason'], 'missing key')
        self.assertTrue(d['errors'])
        self.assertEqual(p.stat().st_mode & 0o777, 0o600)
