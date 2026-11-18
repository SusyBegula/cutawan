"""Freeze YouTube's live-from-start fragment feeds before downloading them.

yt-dlp normally polls these feeds until the broadcast ends. Taking exactly the
first advertised batch saves the rewindable footage without recording forever.
This postprocessor is opt-in and runs at before_dl, after format selection.
"""

import itertools
import re
import time
from urllib.parse import parse_qs, urlsplit

from yt_dlp.postprocessor.common import PostProcessor
from yt_dlp.utils import PostProcessingError


def snapshot_fragments(feed, started_at):
    fragments = iter(feed({'start': started_at}))
    first = next(fragments, None)
    if first is None:
        raise PostProcessingError('No rewindable footage is available yet. Try again shortly.')

    # fragment_count is the absolute sequence at the live edge, not the number
    # of retained fragments. Long broadcasts may start at a nonzero sequence.
    url = urlsplit(first.get('url', ''))
    sequence = parse_qs(url.query).get('sq', [None])[0]
    if sequence is None:
        match = re.search(r'/sq/(\d+)(?:/|$)', url.path)
        sequence = match.group(1) if match else None
    try:
        count = int(first['fragment_count']) - int(sequence)
    except (KeyError, TypeError, ValueError) as error:
        raise PostProcessingError(
            'Could not determine the livestream snapshot boundary. Update yt-dlp and retry.'
        ) from error
    if count <= 0:
        raise PostProcessingError('No rewindable footage is available yet. Try again shortly.')

    # Never request the next fragment after the frozen live edge: doing so
    # resumes yt-dlp's polling loop and turns the import into a live recording.
    result = list(itertools.islice(itertools.chain([first], fragments), count))
    if len(result) != count:
        raise PostProcessingError('The livestream rewind buffer changed. Please retry the import.')
    for fragment in result:
        fragment['fragment_count'] = count
    return result


class CutawanLiveSnapshotPP(PostProcessor):
    def run(self, info):
        # A broadcast may have finished between metadata lookup and download.
        if not info.get('is_live'):
            return [], info
        if info.get('extractor_key', '').lower() != 'youtube':
            raise PostProcessingError('Livestream snapshots currently support YouTube only.')

        formats = info.get('requested_formats') or [info]
        if any(not fmt.get('is_from_start') or not callable(fmt.get('fragments'))
               for fmt in formats):
            raise PostProcessingError(
                'This stream does not expose rewindable footage. Enable DVR on the broadcast '
                'or import its recording after it ends.'
            )

        started_at = time.time()
        # Freeze BOTH tracks before either starts downloading, so neither can
        # include minutes of extra broadcast while the other one downloads.
        for fmt in formats:
            fmt['fragments'] = snapshot_fragments(fmt['fragments'], started_at)
        durations = [len(fmt['fragments']) * fmt['target_duration'] for fmt in formats
                     if isinstance(fmt.get('target_duration'), (int, float)) and fmt['target_duration'] > 0]
        if durations:
            self.to_screen(f'CUTAWAN_SNAPSHOT_DURATION {max(durations)}')
        self.to_screen('Downloading a fixed snapshot of the available livestream footage')
        return [], info
