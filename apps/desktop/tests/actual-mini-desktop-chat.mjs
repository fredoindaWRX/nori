// Actual desktop chat route, not a mocked network or reconstructed system prompt.
import {localChat} from '../bridge/local-chat.mjs'
const cases=[{name:'arithmetic-format',goal:'What is 2 + 2? Reply with only the number.',turns:[]},
  {name:'chat-history',goal:'What is my favorite color? Reply with only the color.',turns:[
    {role:'user',text:'My favorite color is teal.'},
    {role:'assistant',text:'I will remember that your favorite color is teal.'}]}]
for(const item of cases){
  const started=performance.now();let text='',first=null
  try{
    for await(const fragment of localChat({goal:item.goal,turns:item.turns,signal:AbortSignal.timeout(60000)})){
      if(first===null)first=(performance.now()-started)/1000
      text+=fragment
    }
    const passed=item.name==='arithmetic-format'?text.trim()==='4':/^teal[.!]?$/i.test(text.trim())
    console.log(JSON.stringify({case:item.name,text,firstTokenSeconds:first,
      elapsedSeconds:(performance.now()-started)/1000,qualityCheckPassed:passed}))
  }catch(error){
    console.log(JSON.stringify({case:item.name,error:error.message,elapsedSeconds:(performance.now()-started)/1000,
      qualityCheckPassed:false}));process.exitCode=1;break
  }
}
