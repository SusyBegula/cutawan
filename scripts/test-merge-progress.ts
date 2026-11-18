/** Offline yt-dlp/FFmpeg merge, including progress, quoting and full decode.
 * Run: npx tsx --tsconfig tsconfig.node.json scripts/test-merge-progress.ts
 * Requires the yt-dlp binary installed by the local setup (or YTDLP_BIN).
 */
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import ffmpeg from 'ffmpeg-static'
import ffprobe from '@ffprobe-installer/ffprobe'
import type { ImportProgress } from '../src/shared/types'
import { createMergeReporter, mergerArgs } from '../src/main/pipeline/mergeProgress'

const exec = promisify(execFile)
const work = resolve('.tmp', 'merge-progress-test')
const binary = process.env.YTDLP_BIN ?? resolve('.tmp', 'dev-profile', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp_linux')

async function main(): Promise<void> {
  assert.ok(ffmpeg)
  await mkdir(work, { recursive: true })
  await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=12',
    '-f', 'lavfi', '-i', 'sine=frequency=330:duration=12',
    '-map', '0:v', '-c:v', 'libx264', '-preset', 'ultrafast', '-an', join(work, 'video.mp4'),
    '-map', '1:a', '-c:a', 'aac', '-vn', join(work, 'audio.m4a')])

  const server = createServer(async (request, response) => {
    const path = request.url === '/video.mp4' ? join(work, 'video.mp4')
      : request.url === '/audio.m4a' ? join(work, 'audio.m4a') : undefined
    if (!path) { response.writeHead(404).end(); return }
    const info = await stat(path)
    response.writeHead(200, { 'Content-Length': info.size, 'Content-Type': 'video/mp4' })
    createReadStream(path).pipe(response)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const manifest = join(work, 'fixture.json')
  await writeFile(manifest, JSON.stringify({ id: 'merge-check', title: 'Merge check', duration: 12, formats: [
    { format_id: 'video', url: `${base}/video.mp4`, ext: 'mp4', vcodec: 'h264', acodec: 'none', height: 180 },
    { format_id: 'audio', url: `${base}/audio.m4a`, ext: 'm4a', acodec: 'aac', vcodec: 'none' }
  ] }))
  const progressPath = join(work, "merge report's.progress")
  const events: ImportProgress[] = []
  const reporter = createMergeReporter(progressPath, event => { events.push(event) }, 12)
  let log = ''
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(binary, ['--ignore-config', '--verbose', '--no-warnings', '--newline', '--force-overwrites',
        '--load-info-json', manifest, '-f', 'video+audio', '--merge-output-format', 'mp4',
        '--ffmpeg-location', ffmpeg!, '--postprocessor-args', mergerArgs(progressPath),
        // Slow only this tiny fixture so the watcher receives intermediate reports.
        '--postprocessor-args', 'Merger+ffmpeg_i:-readrate 4', '-o', join(work, 'merged.mp4')], { windowsHide: true })
      let pending = ''
      child.stdout.on('data', (data: Buffer) => {
        const text = data.toString()
        log += text
        pending += text
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        for (const line of lines) if (line.includes('[Merger]')) reporter.start()
      })
      child.stderr.on('data', (data: Buffer) => { log += data.toString() })
      child.on('error', reject)
      child.on('close', code => code === 0 ? resolve() : reject(new Error(`yt-dlp exited ${code}: ${log.slice(-2000)}`)))
    })
    await reporter.finish()
    await writeFile(join(work, 'yt-dlp.log'), log)
    await writeFile(join(work, 'events.json'), JSON.stringify(events, null, 2))
    assert.ok(events.some(event => event.phaseProgress !== undefined && event.phaseProgress > 0 && event.phaseProgress < 1), 'Expected intermediate merge percentage')
    assert.equal(events.at(-1)?.phaseProgress, 1)
    assert.match(log, /-c copy/)
    assert.match(log, /-movflags \+faststart -movflags -faststart/)

    const output = join(work, 'merged.mp4')
    const { stdout } = await exec(ffprobe.path, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name', '-of', 'json', output])
    const media = JSON.parse(stdout) as { format: { duration: string }; streams: { codec_type: string }[] }
    assert.ok(Number(media.format.duration) >= 11.9)
    assert.deepEqual(media.streams.map(stream => stream.codec_type).sort(), ['audio', 'video'])
    await exec(ffmpeg, ['-v', 'error', '-i', output, '-f', 'null', '-'])
    const data = await readFile(output)
    assert.ok(data.indexOf(Buffer.from('moov')) > data.indexOf(Buffer.from('mdat')), 'Faststart should be disabled')
    console.log('PASS yt-dlp merger options, quoted path, intermediate percentage, final completion and complete audio/video decode')
    console.log(events.find(event => (event.phaseProgress ?? 0) > 0 && (event.phaseProgress ?? 1) < 1)?.message)
  } finally {
    await reporter.stop()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
