"""Offline regressions for the live snapshot boundary. Requires yt-dlp.

Run: python scripts/test-live-snapshot.py
"""

import importlib.util
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import time
import unittest

from yt_dlp import YoutubeDL
from yt_dlp.globals import plugin_dirs
from yt_dlp.plugins import load_all_plugins
from yt_dlp.postprocessor import get_postprocessor
from yt_dlp.utils import PostProcessingError
from urllib.parse import parse_qs, urlsplit

PLUGIN = Path(__file__).resolve().parents[1] / 'resources/yt-dlp-plugins/cutawan/yt_dlp_plugins/postprocessor/live_snapshot.py'
spec = importlib.util.spec_from_file_location('live_snapshot', PLUGIN)
snapshot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snapshot)


def feed(start, stop, legacy=False):
    def fragments(ctx):
        assert ctx['start'] > 0
        for index in range(start, stop):
            url = f'https://example.com/sq/{index}/data' if legacy else f'https://example.com/video?sq={index}'
            # The edge moves during consumption; only the FIRST count matters.
            yield {'url': url, 'fragment_count': stop + index - start}
        raise AssertionError('Snapshot resumed polling past its frozen live edge')
    return fragments


class LiveSnapshotTests(unittest.TestCase):
    def test_plugin_discovery_matches_the_shipped_layout(self):
        plugin_dirs.value = [str(PLUGIN.parents[3])]
        load_all_plugins()
        self.assertEqual(get_postprocessor('CutawanLiveSnapshot').__name__, 'CutawanLiveSnapshotPP')

    def test_stops_before_polling_a_growing_stream(self):
        fragments = snapshot.snapshot_fragments(feed(0, 5), 100)
        self.assertEqual(len(fragments), 5)
        self.assertTrue(all(f['fragment_count'] == 5 for f in fragments))

    def test_handles_older_footage_outside_retained_buffer(self):
        fragments = snapshot.snapshot_fragments(feed(90, 95), 100)
        self.assertEqual(len(fragments), 5)
        self.assertIn('sq=90', fragments[0]['url'])

    def test_handles_legacy_sequence_urls(self):
        self.assertEqual(len(snapshot.snapshot_fragments(feed(3, 6, legacy=True), 100)), 3)

    def test_empty_buffer(self):
        with self.assertRaisesRegex(PostProcessingError, 'No rewindable'):
            snapshot.snapshot_fragments(lambda ctx: iter([]), 100)

    def test_unknown_boundary_fails_without_polling(self):
        with self.assertRaisesRegex(PostProcessingError, 'snapshot boundary'):
            snapshot.snapshot_fragments(lambda ctx: iter([{'url': 'https://example.com'}]), 100)

    def test_invalid_boundary(self):
        with self.assertRaisesRegex(PostProcessingError, 'No rewindable'):
            snapshot.snapshot_fragments(lambda ctx: iter([{'url': 'https://example.com?sq=5', 'fragment_count': 5}]), 100)

    def test_truncated_buffer_is_not_reported_as_a_complete_snapshot(self):
        with self.assertRaisesRegex(PostProcessingError, 'buffer changed'):
            snapshot.snapshot_fragments(lambda ctx: iter([{'url': 'https://example.com?sq=0', 'fragment_count': 5}]), 100)

    def test_both_tracks_frozen_before_download(self):
        formats = [dict(is_from_start=True, fragments=feed(0, count)) for count in (5, 6)]
        info = dict(is_live=True, extractor_key='Youtube', requested_formats=formats)
        snapshot.CutawanLiveSnapshotPP().run(info)
        self.assertEqual([len(f['fragments']) for f in formats], [5, 6])

    def test_finished_broadcast_passes_through(self):
        info = dict(is_live=False)
        self.assertEqual(snapshot.CutawanLiveSnapshotPP().run(info), ([], info))

    def test_reports_the_frozen_duration_for_merge_progress(self):
        formats = [dict(is_from_start=True, fragments=feed(0, count), target_duration=2)
                   for count in (5, 6)]
        processor = snapshot.CutawanLiveSnapshotPP()
        messages = []
        processor.to_screen = messages.append
        processor.run(dict(is_live=True, extractor_key='Youtube', requested_formats=formats))
        self.assertIn('CUTAWAN_SNAPSHOT_DURATION 12', messages)

    def test_non_rewindable_stream_does_not_record_live(self):
        with self.assertRaisesRegex(PostProcessingError, 'rewindable footage'):
            snapshot.CutawanLiveSnapshotPP().run(dict(is_live=True, extractor_key='Youtube'))

    def test_real_downloader_finishes_while_original_feed_would_continue(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                index = int(parse_qs(urlsplit(self.path).query)['sq'][0])
                # Later fragments finish first under parallel downloading. The
                # final file must still contain them in chronological order.
                time.sleep((3 - index % 3) * .005)
                payload = f'fragment {index}\n'.encode()
                self.send_response(200)
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{server.server_port}/video'

        def growing_feed(ctx):
            for index in range(3):
                yield {'url': f'{base}?sq={index}', 'fragment_count': 3}
            raise AssertionError('Downloader followed the live feed past the snapshot')

        try:
            for workers in (1, 16, 32):
                with self.subTest(workers=workers), tempfile.TemporaryDirectory() as root, YoutubeDL({
                    'outtmpl': str(Path(root) / 'snapshot.mp4'), 'quiet': True,
                    'noprogress': True, 'live_from_start': True, 'fixup': 'never',
                    'concurrent_fragment_downloads': workers,
                }) as downloader:
                    downloader.add_post_processor(snapshot.CutawanLiveSnapshotPP(downloader), when='before_dl')
                    downloader.process_ie_result({
                        'id': 'offline-live', 'title': 'Offline live', 'extractor_key': 'Youtube',
                        'is_live': True, 'live_status': 'is_live', 'formats': [{
                            'format_id': 'snapshot', 'url': base, 'ext': 'mp4',
                            'vcodec': 'h264', 'acodec': 'none', 'is_from_start': True,
                            'protocol': 'http_dash_segments_generator', 'fragments': growing_feed,
                        }],
                    })
                    self.assertEqual((Path(root) / 'snapshot.mp4').read_bytes(),
                                     b''.join(f'fragment {i}\n'.encode() for i in range(3)))
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
