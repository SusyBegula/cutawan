# Local Windows setup

Double-click `start-local.cmd` to run the customisable source version with hot reload.
Keep its terminal open while using Cutawan; close the app and press Ctrl+C in the
terminal to stop development. Run the same launcher to start it again.

The launcher stores projects, settings, downloaded tools and models in
`.tmp/dev-profile` inside this checkout. This is separate from an installed EXE's
profile. Do not delete this directory if you want to keep those projects.

For a PowerShell terminal:

```powershell
cd D:\codes\clipEmNuts\cutawan
.\start-local.cmd
```

## YouTube livestream snapshots

Paste an ongoing YouTube livestream link into the regular import box. Cutawan
downloads a fixed snapshot of its currently available rewindable footage, then
merges it into a normal MP4 project. It does not wait for the broadcast to end.
Both audio and video boundaries are frozen before downloading starts.

YouTube must expose rewindable media. Older footage outside its retained buffer
cannot be recovered. Upcoming broadcasts show a message to retry once live;
streams without rewind support need to be imported after their recording becomes
available. Long streams still take time and disk space to download. No AI key is
needed for URL import; transcription and AI analysis are configured in the app's
setup wizard.

Imports use up to thirty-two parallel fragment requests (shared across audio and
video) and show combined transfer speed in MB/s and Mbps. Existing downloads keep
the options they started with; restart the source app to use new downloader
options for subsequent imports.

Merging has a separate progress bar with processed/total video duration,
processing speed and an estimated remaining time. Input preparation shows elapsed
time until FFmpeg can report actual copying progress. Live snapshot duration is
estimated from the fixed fragment count and target fragment duration.

Local source merges use stream copy and skip MP4 fast-start index relocation,
avoiding its second pass over a large file. Merge time still depends on source
structure, packet count, storage and concurrent work; no full-stream speedup has
been measured. The completed source remains a normal MP4 with full audio/video
quality. Relaunch the source app to load these main-process changes.

A comparison of the same 54,249,568 bytes from the supplied livestream measured
2.04 MB/s with one worker, 12.49 MB/s with eight, and 19.39 MB/s with sixteen.
These are short video-only measurements taken while another download was active;
actual full imports vary with the source server and share workers between tracks.

The bundled opt-in yt-dlp postprocessor implements the finite snapshot. It relies
on yt-dlp's YouTube live fragment metadata; unsupported metadata fails explicitly
instead of starting an unbounded recording.

## Customising and building

- `src/renderer/src`: React interface and styles.
- `src/main/pipeline`: downloading, transcription, analysis and video export.
- `src/shared`: caption styles and the shared preview/export planners.

```powershell
npm run build
npm test
npm run typecheck
npm run lint
npm run package
```

`npm run package` creates a Windows installer under `release`. The launcher runs
the source version, so changes here do not modify your existing downloaded EXE.

## Validation

Local transcription was repaired after faster-whisper 1.2.1 was installed with
incompatible PyAV 19.0.2. The private environment now uses PyAV 18.1.0; setup
requires PyAV below 19 while allowing compatible releases for older Python
versions. On Windows with a CUDA GPU, setup also installs the private cuBLAS and
cuDNN runtime packages. Readiness checks decode a short sound and verify the
Windows GPU libraries instead of checking imports alone.

The actual worker passed an offline GPU transcription using the installed
large-v3 model: an 8.85-second spoken fixture returned 19 timestamped words.
Retry transcription on the existing project after this repair; its downloaded
video and model files are preserved.

Build, typecheck and lint pass. The latest full TypeScript run passed all 749
tests. The concurrent project-save test has intermittently failed with Windows
EPERM during earlier runs; project persistence code was not changed here.

The separate Python snapshot suite passes all thirteen tests. It includes yt-dlp
plugin discovery and real downloads from a local growing feed, checking ordered
assembly with one, sixteen and thirty-two workers and completion without polling for more
footage.

```powershell
.\.tmp\plugin-tests\Scripts\python.exe scripts/test-live-snapshot.py
npm exec -- tsx --tsconfig tsconfig.node.json scripts/test-merge-progress.ts
```

The merge integration test uses the real yt-dlp/FFmpeg merger and a local fixture
server. It verifies intermediate percentages, final completion, quoted progress
paths, disabled fast-start relocation and complete audio/video decoding.

A two-second 144p sample from `https://www.youtube.com/watch?v=qSyo5d-dVzA`
was downloaded using the shipped snapshot plugin and merged successfully into
`.tmp/live-snapshot-test.mp4`, with H.264 video and AAC audio. The whole broadcast
was not downloaded during setup.
