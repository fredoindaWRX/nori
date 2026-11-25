import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, openSync, ftruncateSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { resolveGeneratedVideoFile, serveGeneratedVideo } from '../bridge/generated-video-file.mjs'

test('generated video resolver allows only nonempty MP4s under the private output root', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'nori-generated-video-'))
  try {
    const output = join(temp, 'image-runtime', 'output', 'nori')
    mkdirSync(output, { recursive: true })
    const file = join(output, 'clip.mp4')
    writeFileSync(file, Buffer.from('synthetic-mp4-fixture'))
    const accepted = await resolveGeneratedVideoFile(file, temp)
    assert.equal(accepted.path, file)
    assert.equal(accepted.mimeType, 'video/mp4')
    assert.equal(accepted.size, 21)
    const elsewhere = join(temp, 'outside.mp4')
    writeFileSync(elsewhere, 'not inside nori output')
    await assert.rejects(resolveGeneratedVideoFile(elsewhere, temp), /outside Nori/)
    const wrongType = join(output, 'payload.html')
    writeFileSync(wrongType, '<html>')
    await assert.rejects(resolveGeneratedVideoFile(wrongType, temp), /outside Nori/)
  } finally { rmSync(temp, { recursive: true, force: true }) }
})

test('generated-video bridge serves a local MP4 with byte ranges and refuses outside paths', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'nori-generated-video-http-'))
  const output = join(temp, 'image-runtime', 'output', 'nori')
  mkdirSync(output, { recursive: true })
  const payload = Buffer.from('0123456789-local-mp4-fixture')
  const file = join(output, 'clip.mp4')
  const outside = join(temp, 'outside.mp4')
  writeFileSync(file, payload)
  writeFileSync(outside, 'private-outside-file')
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    void serveGeneratedVideo(req, res, {}, url.searchParams.get('path'), temp)
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/generated-video?path=`
    const normal = await fetch(endpoint + encodeURIComponent(file))
    assert.equal(normal.status, 200)
    assert.equal(normal.headers.get('content-type'), 'video/mp4')
    assert.deepEqual(Buffer.from(await normal.arrayBuffer()), payload)
    const ranged = await fetch(endpoint + encodeURIComponent(file), { headers: { range: 'bytes=3-7' } })
    assert.equal(ranged.status, 206)
    assert.equal(ranged.headers.get('content-range'), `bytes 3-7/${payload.length}`)
    assert.equal(await ranged.text(), '34567')
    const denied = await fetch(endpoint + encodeURIComponent(outside))
    assert.equal(denied.status, 400)
    const invalidRange = await fetch(endpoint + encodeURIComponent(file), { headers: { range: 'bytes=999-1000' } })
    assert.equal(invalidRange.status, 416)
  } finally {
    server.closeAllConnections(); await new Promise(done => server.close(done))
    rmSync(temp, { recursive: true, force: true })
  }
})

test('long generated videos above 200 MiB remain streamable without whole-file buffering', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'nori-long-video-range-'))
  const output = join(temp, 'image-runtime', 'output')
  mkdirSync(output, {recursive:true})
  const file = join(output, 'long.mp4')
  const fd = openSync(file, 'wx')
  try { ftruncateSync(fd, 201 * 1024 * 1024) } finally { closeSync(fd) }
  const server = createServer((req,res) => void serveGeneratedVideo(req,res,{},file,temp))
  await new Promise(done => server.listen(0,'127.0.0.1',done))
  try {
    assert.equal((await resolveGeneratedVideoFile(file,temp)).size,201*1024*1024)
    const response=await fetch(`http://127.0.0.1:${server.address().port}`,{headers:{range:'bytes=-16'}})
    assert.equal(response.status,206)
    assert.equal(response.headers.get('content-length'),'16')
    assert.equal((await response.arrayBuffer()).byteLength,16)
  }finally{
    server.closeAllConnections();await new Promise(done=>server.close(done))
    rmSync(temp,{recursive:true,force:true})
  }
})

