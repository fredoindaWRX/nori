import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'

// Local output is streamed, never buffered wholesale. Duration is bounded by
// verified job resources, not the former 200 MiB short-clip delivery cutoff.
export const MAX_GENERATED_VIDEO_BYTES = Number.MAX_SAFE_INTEGER
export function generatedVideoOutputRoot(appDataRoot) {
  const configured=process.env.NORI_VIDEO_OUTPUT_ROOT
  if(configured&&!isAbsolute(configured))throw Error('Video output root must be an absolute owned directory.')
  return resolve(configured||resolve(appDataRoot,'image-runtime','output'))
}

/** Validate a video blade path against the single Nori-owned output directory. */
export async function resolveGeneratedVideoFile(askedPath, appDataRoot) {
  if (typeof appDataRoot !== 'string' || !appDataRoot || typeof askedPath !== 'string' || !isAbsolute(askedPath)) {
    throw new TypeError('Generated video path is not an absolute local path.')
  }
  const root = await realpath(generatedVideoOutputRoot(appDataRoot))
  const real = await realpath(askedPath)
  const rel = relative(root, real)
  const extension = real.slice(real.lastIndexOf('.')).toLowerCase()
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || extension !== '.mp4') throw new Error('Generated video is outside Nori’s local output folder.')
  const info = await stat(real)
  if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size <= 0 || info.size > MAX_GENERATED_VIDEO_BYTES) throw new Error('Generated video is empty or exceeds Nori’s local delivery limit.')
  return Object.freeze({ path: real, size: info.size, mimeType: 'video/mp4' })
}

/** Serve a validated result with browser-compatible Range support. */
export async function serveGeneratedVideo(req, res, cors, askedPath, appDataRoot) {
  let generated
  try { generated = await resolveGeneratedVideoFile(askedPath, appDataRoot) } catch {
    res.writeHead(400, cors)
    res.end('generated videos only')
    return
  }
  const { path, size, mimeType } = generated
  const headers = { ...cors, 'content-type': mimeType, 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff' }
  const range = req.headers.range
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!match || (!match[1] && !match[2])) {
      res.writeHead(416, { ...headers, 'content-range': `bytes */${size}` })
      res.end()
      return
    }
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
    let end = match[2] && match[1] ? Number(match[2]) : size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
      res.writeHead(416, { ...headers, 'content-range': `bytes */${size}` })
      res.end()
      return
    }
    end = Math.min(end, size - 1)
    res.writeHead(206, { ...headers, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}` })
    const stream = createReadStream(path, { start, end })
    stream.on('error', () => res.destroy())
    stream.pipe(res)
    return
  }
  res.writeHead(200, { ...headers, 'content-length': String(size) })
  const stream = createReadStream(path)
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}

