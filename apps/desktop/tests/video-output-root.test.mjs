import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {generatedVideoOutputRoot,resolveGeneratedVideoFile} from '../bridge/generated-video-file.mjs'
test('an explicit media output root replaces the AppData root without widening containment',async()=>{
 const root=await mkdtemp(join(tmpdir(),'nori-video-root-')),prior=process.env.NORI_VIDEO_OUTPUT_ROOT
 try{
  const output=join(root,'canonical-output'),old=join(root,'image-runtime','output')
  await mkdir(output);await mkdir(old,{recursive:true})
  await writeFile(join(output,'clip.mp4'),'synthetic');await writeFile(join(old,'clip.mp4'),'synthetic')
  process.env.NORI_VIDEO_OUTPUT_ROOT=output
  assert.equal(generatedVideoOutputRoot(root),output)
  assert.equal((await resolveGeneratedVideoFile(join(output,'clip.mp4'),root)).path,await realpath(join(output,'clip.mp4')))
  await assert.rejects(resolveGeneratedVideoFile(join(old,'clip.mp4'),root),/outside/)
  process.env.NORI_VIDEO_OUTPUT_ROOT='relative-root'
  assert.throws(()=>generatedVideoOutputRoot(root),/absolute/)
 }finally{
  if(prior===undefined)delete process.env.NORI_VIDEO_OUTPUT_ROOT;else process.env.NORI_VIDEO_OUTPUT_ROOT=prior
  await rm(root,{recursive:true,force:true})
 }
})
