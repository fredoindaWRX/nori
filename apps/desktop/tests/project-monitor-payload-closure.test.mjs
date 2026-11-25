import test from 'node:test'
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import {nativePayloadPlan} from '../scripts/native-payload-plan.mjs'
test('single-app payload includes expanded phone dashboard module and owner scope metadata',()=>{
  const root=fileURLToPath(new URL('../../../',import.meta.url))
  const files=new Set(nativePayloadPlan(root).files.map(file=>file.path))
  for(const path of ['integrations/project-monitor/expanded-roadmap.mjs','docs/nori-expanded-owner-roadmap.json'])
    assert.ok(files.has(path),`Missing phone dashboard dependency: ${path}`)
  assert.equal(files.has('integrations/project-monitor/expanded-roadmap.test.mjs'),false)
})
