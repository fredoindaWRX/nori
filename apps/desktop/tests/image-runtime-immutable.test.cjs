const test=require('node:test')
const assert=require('node:assert/strict')
const {readFileSync}=require('node:fs')
const {resolve}=require('node:path')

test('embedded image Python explicitly disables bytecode writes before startup imports',()=>{
  const main=readFileSync(resolve(__dirname,'../desktop/main.cjs'),'utf8')
  const startup=readFileSync(resolve(__dirname,'../desktop/comfy-startup.cjs'),'utf8')
  assert.match(main,/const args = comfyLaunchArgs\(/)
  assert.match(main,/spawn\(COMFY_PYTHON, args/)
  assert.match(startup,/return \['-B', '-s', 'main\.py'/)
  for(const flag of ['--disable-assets','--input-directory','--output-directory','--temp-directory','--user-directory'])
    assert.ok(startup.includes(flag),flag)
})
