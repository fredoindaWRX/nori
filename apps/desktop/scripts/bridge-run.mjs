/** Cross-platform bridge launcher. */
const args = new Set(process.argv.slice(2))
if (args.has('--writes')) process.env.NORI_ALLOW_WRITES = '1'
if (args.has('--claude')) throw new Error('Paid/cloud providers are disabled. Use the local Nori bridge.')
await import('../bridge/server.mjs')
