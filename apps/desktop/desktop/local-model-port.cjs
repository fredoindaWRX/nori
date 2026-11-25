const {createServer}=require('node:net')
function assertPortAvailable(port){
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local model port')
  return new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(port,'127.0.0.1',()=>server.close(error=>error?reject(error):resolve()))})
}
module.exports={assertPortAvailable}
