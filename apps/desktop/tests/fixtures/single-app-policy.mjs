import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

const source=fileURLToPath(new URL('../../../../',import.meta.url))
export function seedSingleAppPolicy(root) {
  for(const path of ['verification/single-app-development-contract.json','apps/desktop/package.json',
    'apps/desktop/desktop/main.cjs','apps/desktop/native-suite-installer.iss',
    'apps/desktop/scripts/build-native-installer.mjs']) {
    const target=join(root,path)
    mkdirSync(dirname(target),{recursive:true})
    writeFileSync(target,readFileSync(join(source,path)),{flag:'wx'})
  }
}
export async function seedSingleAppArchive(root,desktop) {
  const staging=join(root,'archive-fixture')
  mkdirSync(join(staging,'desktop'),{recursive:true})
  writeFileSync(join(staging,'package.json'),JSON.stringify({name:'nori',productName:'N.O.R.I.',main:'desktop/main.cjs',version:'1.0.0'}))
  writeFileSync(join(staging,'desktop/main.cjs'),readFileSync(join(root,'apps/desktop/desktop/main.cjs')))
  mkdirSync(join(desktop,'resources'),{recursive:true})
  const {createPackage}=createRequire(import.meta.url)('@electron/asar')
  await createPackage(staging,join(desktop,'resources/app.asar'))
}
