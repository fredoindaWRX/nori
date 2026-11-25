import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {understandLocalImage} from 'file:///C:/Program%20Files/Nori/resources/NoriSuite/apps/desktop/bridge/local-vision.mjs'
const report='C:/Nori/.work/reports/vision-model-team-probe.json'
assert.ok(!existsSync(report),'Existing evidence preserved')
const began=performance.now()
const reply=await understandLocalImage({mimeType:'image/png',data:readFileSync('C:/Nori/.work/reports/model-team-vision-fixture.png').toString('base64')},
 'What color is the circle? Answer with one color word only.',{root:'C:/Program Files/Nori/resources/NoriSuite',
 appDataRoot:'C:/Nori/.work/reports',gpuLayers:0,outputTokens:16})
assert.match(reply,/\bred\b/i)
const result={passed:true,model:'Qwen2.5-VL-3B-Instruct',backend:'cpu',reply,
 elapsedSeconds:Number(((performance.now()-began)/1000).toFixed(3)),installedAdapterVerified:true,
 syntheticImageOnly:true,cameraUsed:false,screenCaptured:false}
writeFileSync(report,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result))
