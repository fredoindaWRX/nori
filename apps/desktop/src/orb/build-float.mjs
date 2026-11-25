// Builds the floating desktop window's script (her form + type box): node src/orb/build-float.mjs --write
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {writeFileSync} from 'node:fs'
import path from 'node:path'
const here=path.dirname(fileURLToPath(import.meta.url))
const desktop=path.resolve(here,'../..')
const deps=process.env.NORI_ORB_BUILD_DEPS || path.join(desktop,'node_modules')
const require=createRequire(path.join(deps,'package.json'))
const esbuild=require(path.join(deps,'esbuild'))
const result=await esbuild.build({bundle:true,minify:true,target:'chrome130',legalComments:'none',nodePaths:[deps],logLevel:'warning',entryPoints:[path.join(here,'float.js')],format:'esm',write:false})
const content=result.outputFiles[0].contents
const output=path.join(desktop,'dist/assets/nori-orb-float-20261108.js')
if(process.argv.includes('--write'))writeFileSync(output,content)
console.log(JSON.stringify({sha256:createHash('sha256').update(content).digest('hex'),bytes:content.length,written:process.argv.includes('--write'),output}))
