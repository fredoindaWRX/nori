// Focused, read-only type check. Reuse the recovered baseline's installed compiler.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
const baseline = resolve('../nori-ui-reconstruction-001')
const require = createRequire(resolve(baseline, 'package.json'))
const ts = require('typescript')
const options = {
  noEmit: true, noUnusedLocals: true, noUnusedParameters: true, skipLibCheck: true,
  target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true,
  lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  typeRoots: [resolve(baseline, 'node_modules/@types')],
}
const host = ts.createCompilerHost(options)
host.resolveModuleNames = (names, file) => names.map(name => ts.resolveModuleName(
  name, name.startsWith('.') ? file : resolve(baseline, 'src', 'dependency-probe.ts'), options, host,
).resolvedModule)
const roots = ['src/lib/voice.ts', 'src/lib/tts.ts', 'src/config.ts', 'src/lib/capabilities.ts',
  resolve(baseline, 'node_modules/vite/client.d.ts')]
const program = ts.createProgram(roots, options, host)
const errors = ts.getPreEmitDiagnostics(program)
for (const error of errors) console.log(ts.flattenDiagnosticMessageText(error.messageText, '\n'))
console.log(`Focused local speech type check: ${errors.length} diagnostics`)
process.exitCode = errors.length ? 1 : 0
