import assert from 'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';
const p='C:/Nori/.work/project-review-repair/local-chat.installed.mjs';let s=readFileSync(p,'utf8');
const helper=`export function projectReviewSourceReadAttempts(messages) {\n  const paths = new Set()\n  for (const message of messages) {\n    if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue\n    for (const call of message.tool_calls) {\n      if (call.function?.name !== 'read_file') continue\n      try {\n        const path = String(JSON.parse(call.function.arguments).path ?? '').replace(/\\\\/g, '/')\n        if (isNoriReviewSourcePath(path)) paths.add(path)\n      } catch {}\n    }\n  }\n  return paths.size\n}\n\n`;
assert.equal(s.split('function projectFileReadAttempted(messages)').length,2);s=s.replace('function projectFileReadAttempted(messages)',helper+'function projectFileReadAttempted(messages)');
for(const [from,to] of [
 ['projectReviewTurn ? 4 : GPT_OSS_TOOL_MAX_ROUNDS','projectReviewTurn ? 8 : GPT_OSS_TOOL_MAX_ROUNDS'],
 ['projectReviewTurn ? 3 : GPT_OSS_TOOL_MAX_CALLS_PER_TURN','projectReviewTurn ? 6 : GPT_OSS_TOOL_MAX_CALLS_PER_TURN'],
 ['if (projectReviewTurn && projectReviewSourceReadAttempted) {','if (projectReviewTurn && projectReviewSourceReadAttempts(currentMessages) >= 3) {'],
 ['One successful source-read attempt is enough to ground this narrow','Three distinct source-read attempts bound this read-only'],
 ['One bounded source read has been attempted; no further tools are available.','Three distinct bounded source reads have been attempted; no further tools are available.'],
 ['In at most 80 words, report only concrete observations from that source result','In at most 220 words, report only concrete observations from those source results'],
 ['Locate and read at least one relevant source file within the bounded inspection budget;','Use the bounded inspection budget to read relevant implementation and test files (up to three distinct source paths), following imports when useful. Do not stop merely because an initial excerpt lists imports;'],
 ]){assert.equal(s.split(from).length,2,from);s=s.replace(from,to)}
writeFileSync('C:/Nori/.work/project-review-repair/local-chat.next.mjs',s);console.log('Prepared installed-derived bounded multi-file review patch');
