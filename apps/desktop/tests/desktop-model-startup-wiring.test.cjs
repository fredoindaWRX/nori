const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ts=require('typescript');
const {desktopImportedModelProfile}=require('../desktop/imported-model-profile.cjs');
const {resolveGptOssContextTokens}=require('../desktop/native-service.cjs');
test('normal packaged startup retains at least 64K and owned automatic/media lifecycle',()=>{
 const file=ts.createSourceFile('main.cjs',fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),calls=[];
 function walk(node){if(ts.isCallExpression(node))calls.push(node);ts.forEachChild(node,walk);}walk(file);
 const owned=calls.filter(call=>call.expression.getText(file)==='startVideoCapableModelService');assert.equal(owned.length,1);
 const options=owned[0].arguments[0];assert.ok(ts.isObjectLiteralExpression(options));
 const property=name=>options.properties.find(item=>item.name?.getText(file)===name)?.initializer;
 assert.equal(property('modelProfile')?.getText(file),'IMPORTED_MODEL_PROFILE.id');
 const context=property('contextTokens');assert.ok(ts.isCallExpression(context));assert.equal(context.expression.getText(file),'resolveGptOssContextTokens');assert.match(context.arguments[0].getText(file),/IMPORTED_MODEL_PROFILE\.defaultContext/);
 const profile=desktopImportedModelProfile({packaged:true});
 const defaultContext=resolveGptOssContextTokens(String(profile.defaultContext));
 assert.ok(defaultContext>=65536,'Packaged default must preserve the owner context floor');
 for(const fallback of profile.fallbackContexts??[])assert.ok(resolveGptOssContextTokens(String(fallback.context))>=65536,'Qualified fallback must preserve the floor');
 assert.ok(calls.some(call=>call.expression.getText(file)==='startAutomaticTextService'));
 assert.ok(calls.some(call=>call.expression.getText(file)==='releaseVideoRuntime'));
 for(const call of calls.filter(call=>call.expression.getText(file)==='startGptOssService')){
  const member=call.arguments[0]?.properties?.find(item=>item.name?.getText(file)==='contextTokens');
  const budget=member&&ts.isShorthandPropertyAssignment(member)?member.name:member?.initializer;
  assert.ok(budget);assert.ok(!ts.isNumericLiteral(budget)||Number(budget.text)>=65536,'No stale 4K/8K literal in imported startup');
 }
});
test('restored production modules parse without launching apps, workers or permission dialogs',()=>{
 const vm=require('node:vm');
 for(const name of ['browser-host','media-permission-policy','mentor-credential','mentor-startup','mobile-voice','proactive-activity','proactive-create','remote-access-status','system-activity','system-confirmation','voice-activity','worker-confirmation','worker-environment','worker-workspace']){
  const filename=path.join(__dirname,'../desktop',name+'.cjs');assert.doesNotThrow(()=>new vm.Script(fs.readFileSync(filename,'utf8'),{filename}));
 }
});
