import assert from 'node:assert/strict';
import { verifiedSetupAnswer, answerQuestion } from './nori-stream-answer.mjs';
const samples=['Is private Discord on monitor 2 safe if OBS captures it?', 'Does screen 1 OBS capture leak private windows from screen 2?', 'Is OBS screen two safe for Discord?'];
for(const q of samples){const answer=verifiedSetupAnswer(q);assert.ok(answer);assert.match(answer,/does not automatically show Monitor 2/);assert.match(answer,/Monitor 2 can appear/);}
for(const q of ['How do I animate a scene?', 'Is Discord safe to use?', 'How do I capture a game?'])assert.equal(verifiedSetupAnswer(q),null);
const actual=await answerQuestion({question:samples[0],topic:''});assert.equal(actual.backend,'verified-stream-setup');assert.equal(actual.model,null);assert.equal(actual.postedToChat,false);
console.log(JSON.stringify({status:'passed',knownSetupCases:samples.length,unrelatedQuestionsExcluded:3,modelUsedForVerifiedFacts:false}));
