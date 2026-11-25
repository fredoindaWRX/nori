import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const [source, destination] = process.argv.slice(2)
if (!source || !destination) throw new Error('Usage: node import-boot-video.mjs <source> <destination>')
if (!existsSync(source)) throw new Error(`Startup video was not found: ${source}`)
mkdirSync(dirname(resolve(destination)), { recursive: true })
copyFileSync(source, destination)
console.log(`Imported approved Nori startup video: ${destination}`)
