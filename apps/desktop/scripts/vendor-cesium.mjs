import { cp, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'node_modules', 'cesium', 'Build', 'Cesium')
const target = path.join(root, 'public', 'cesium')
await mkdir(target, { recursive: true })
for (const name of ['Assets', 'ThirdParty', 'Workers', 'Widgets']) {
  await cp(path.join(source, name), path.join(target, name), { recursive: true })
}
console.log('  bundled the local Cesium globe runtime.')
