const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const parse=name=>ts.createSourceFile(name,fs.readFileSync(path.resolve(__dirname,'../desktop',name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const isCall=(node,object,methods)=>ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.expression.getText()===object&&methods.includes(node.expression.name.text);
test('every renderer RPC has a source host registration, including loop-registered legacy controls',()=>{
 const main=parse('main.cjs'),preload=parse('workspace-preload.cjs'),host=new Set(),renderer=new Set();
 function walk(node,tree,object,methods,out){
  if(isCall(node,object,methods)&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0]))out.add(node.arguments[0].text);
  if(object==='ipcMain'&&ts.isForOfStatement(node)&&ts.isArrayLiteralExpression(node.expression)){
   const variable=node.initializer.declarations?.[0]?.name?.getText(tree);let registered=false;
   function inspect(child){if(isCall(child,'ipcMain',['handle','on'])&&child.arguments[0]?.getText(tree)===variable)registered=true;ts.forEachChild(child,inspect);}inspect(node.statement);
   if(registered)for(const value of node.expression.elements)if(ts.isStringLiteral(value))out.add(value.text);
  }
  ts.forEachChild(node,child=>walk(child,tree,object,methods,out));
 }
 walk(main,main,'ipcMain',['handle','on'],host);walk(preload,preload,'ipcRenderer',['invoke','send','sendSync'],renderer);
 assert.ok(renderer.size>=40);assert.deepEqual([...renderer].filter(channel=>!host.has(channel)),[]);
});
function installerFixture({fail=false}={}){
 const main=parse('main.cjs'),fn=main.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='openNoriSkillInstaller');assert.ok(fn);
 const registration=main.statements.find(node=>ts.isExpressionStatement(node)&&isCall(node.expression,'ipcMain',['handle'])&&node.expression.arguments[0]?.text==='nori:skills:install-local-zip');assert.ok(registration);
 const frame={},window={isDestroyed:()=>false,webContents:{mainFrame:frame}},owner={sender:window.webContents,senderFrame:frame},receipt={outcome:'review-cancelled',installed:false};let calls=0,errors=0,handler;
 const context={window,process:{argv:['Nori.exe']},app:{whenReady:async()=>{}},dialog:{showErrorBox:()=>{errors++;}},nativeSkillInstaller:()=>({install:async selected=>{assert.equal(selected,undefined);calls++;if(fail)throw Error('synthetic bad archive');return receipt;}}),ipcMain:{handle:(name,fn)=>{assert.equal(name,'nori:skills:install-local-zip');handler=fn;}}};
 vm.runInNewContext(fn.getText(main)+'\n'+registration.getText(main),context);
 return{context,owner,receipt,handler,calls:()=>calls,errors:()=>errors};
}
test('Skill ZIP handler rejects another frame before opening any picker and returns owner cancellation receipt',async()=>{
 const f=installerFixture();await assert.rejects(f.handler({sender:{},senderFrame:{}}),/main desktop window/);assert.equal(f.calls(),0);
 assert.equal(await f.handler(f.owner),f.receipt);assert.equal(f.calls(),1);assert.equal(f.errors(),0);
});
test('Skill ZIP errors return an explicit failed receipt instead of undefined',async()=>{
 const f=installerFixture({fail:true}),result=await f.handler(f.owner);assert.equal(result.installed,false);assert.equal(result.outcome,'error');assert.equal(f.errors(),1);
});
