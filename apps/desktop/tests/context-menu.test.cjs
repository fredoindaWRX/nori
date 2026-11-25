const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { contextMenuTemplate, installContextMenu } = require('../desktop/context-menu.cjs')

test('editable fields offer standard editing without execution actions', () => {
  assert.deepEqual(contextMenuTemplate({isEditable:true}).filter(x=>x.role).map(x=>x.role),
    ['undo','redo','cut','copy','paste','selectAll'])
})
test('noneditable selected text offers copy, not paste or cut', () => {
  assert.deepEqual(contextMenuTemplate({selectionText:'Nori'}).map(x=>x.role),['copy','selectAll'])
  assert.deepEqual(contextMenuTemplate().map(x=>x.role),['selectAll'])
})
test('window context event opens menu and detaches cleanly', () => {
  const contents = new EventEmitter()
  contents.isDestroyed = () => false
  const window = {webContents:contents,isDestroyed:()=>false}
  let opened = 0
  const detach = installContextMenu(window,{buildFromTemplate:()=>({popup:args=>{
    assert.equal(args.window,window); opened++
  }})})
  contents.emit('context-menu',{}, {isEditable:true})
  assert.equal(opened,1)
  detach()
  contents.emit('context-menu',{}, {})
  assert.equal(opened,1)
})
