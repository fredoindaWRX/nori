import{readFileSync,writeFileSync}from'node:fs';import assert from'node:assert/strict';
for(const [source,dest]of [['C:/Nori/apps/desktop/bridge/rea-tools.mjs','C:/Nori/.work/rea-route-repair/rea-tools.source-final.mjs'],['C:/Nori/.work/rea-route-repair/rea-tools.mjs','C:/Nori/.work/rea-route-repair/rea-tools.mjs']]){
 let s=readFileSync(source,'utf8');const start=s.indexOf('export function noriReaMissingTargetResponse() {'),end=s.indexOf('\n}',start)+2;assert.ok(start>0&&end>start);
 s=s.slice(0,start)+`export function noriReaMissingTargetResponse() {\n  return 'I can use REA to statically inspect third-party apps as well as Nori-built apps. Paste one exact local .exe, .dll, or .asar path, and I will bind it to this request. Built app folders also need an exact quoted path. I will not launch or modify the target.'\n}`+s.slice(end);writeFileSync(dest,s)
}
