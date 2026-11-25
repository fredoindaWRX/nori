import test from 'node:test'
import assert from 'node:assert/strict'
import {WAKE,afterWake,BARE_NAME,LEADING_NAME} from '../src/lib/wake.ts'
test('Nori wake matches local name variants and preserves the spoken request',()=>{
  for(const name of ['Nori','Norrie','Norry','Norri'])assert.equal(WAKE.test('Hey '+name),true)
  assert.equal(afterWake('Hey Nori, open my notes'),'open my notes')
  assert.equal(BARE_NAME.test('hey Norrie!'),true)
  assert.equal('Nori, open my notes'.replace(LEADING_NAME,''),'open my notes')
})
test('legacy assistant names and possessive mentions do not wake Nori',()=>{
  for(const text of ['Travis','Jervis','Jarvys','Jarv',"Java's","Nori's settings",'Nori’s settings','Noris','Noriko'])
    {assert.equal(WAKE.test(text),false,text);assert.equal(LEADING_NAME.test(text),false,text)}
})
