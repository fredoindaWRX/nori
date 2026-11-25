import{readFileSync,writeFileSync}from'node:fs';import assert from'node:assert/strict';
const file='C:/Nori/apps/desktop/bridge/rea-tools.mjs';let s=readFileSync(file,'utf8');
const anchor='function nodeExecutable(environment) {';assert.equal(s.split(anchor).length,2);
const helper=`function managedNoriToolRoot(environment) {\n  const desktop = environment.NORI_APP_DATA_ROOT\n  if (typeof desktop !== 'string' || path.basename(desktop).toLowerCase() !== 'desktop'\n      || path.basename(path.dirname(desktop)).toLowerCase() !== 'state') return null\n  const root = path.resolve(desktop, '..', '..')\n  if (path.basename(root).toLowerCase() !== 'nori') return null\n  return verifiedDirectory(root, ['state/desktop'])\n}\n\n`;
s=s.replace(anchor,helper+anchor);
s=s.replace('const candidates = [environment.NORI_REA_NODE,','const managedRoot = managedNoriToolRoot(environment)\n  const candidates = [environment.NORI_REA_NODE,\n    managedRoot ? path.join(managedRoot, \'tools\', \'node-v26.12.1-win-x64\', \'node.exe\') : \'\',');
s=s.replace('const candidates = [environment.NORI_REA_SCRIPT,','const managedRoot = managedNoriToolRoot(environment)\n  const candidates = [environment.NORI_REA_SCRIPT,\n    managedRoot ? path.join(managedRoot, \'integrations\', \'rea\', \'node_modules\', \'rea-agents\', \'scripts\', \'rea.mjs\') : \'\',');
s=s.replace('Nori is pinned to REA ${REA_PACKAGE_VERSION}; the installed package identity differs.','Nori is pinned to REA ${REA_PACKAGE_VERSION}; found ${metadata?.version ?? \'unknown\'} at ${candidate}. The installed package identity differs.');
writeFileSync('C:/Nori/.work/rea-route-repair/rea-tools.runtime-path-next.mjs',s);
