const fs=require('fs'),path=require('path');const root=__dirname;
const c=JSON.parse(fs.readFileSync(path.join(root,'obs/Nori-Stream.json'),'utf8'));
c.name='Nori Animated Monitors';c.current_scene=c.current_program_scene='Starting Soon';
function item(name,id,x=0,y=0,scale=1){return {name,id,visible:true,locked:true,rot:0,pos:{x,y},scale:{x:scale,y:scale},align:5,bounds_type:0,bounds_align:0,bounds:{x:0,y:0},crop_left:0,crop_top:0,crop_right:0,crop_bottom:0}}
for(let n=1;n<=2;n++){
 c.sources.push({name:'Capture — Monitor '+n,id:'monitor_capture',versioned_id:'monitor_capture',settings:{monitor_id:'\\\\.\\DISPLAY'+n,method:0,capture_cursor:true,force_sdr:true},mixers:0,muted:true,enabled:true});
 for(const kind of ['Coding','Nori Demo']){
  const name=kind+' — Monitor '+n,slug=(kind==='Coding'?'coding':'nori-demo')+'-monitor-'+n;
  const original=fs.readFileSync(path.join(root,'scenes',kind==='Coding'?'coding.html':'nori-demo.html'),'utf8');
  fs.writeFileSync(path.join(root,'scenes',slug+'.html'),original.replace('<title>Nori · '+kind+'</title>','<title>Nori · '+name+'</title>').replace(kind==='Coding'?'BUILD SESSION':'DEMO SESSION','MONITOR '+n+' / '+(kind==='Coding'?'BUILD':'DEMO')).replace('<span>'+kind.toUpperCase()+'</span>','<span>'+kind.toUpperCase()+' / MONITOR '+n+'</span>'));
  const graphic='Graphics — '+name;
  c.sources.push({name:graphic,id:'browser_source',versioned_id:'browser_source',settings:{is_local_file:true,local_file:path.join(root,'scenes',slug+'.html').replaceAll('\\','/'),width:1920,height:1080,fps:30,fps_custom:true,shutdown:true,css:'body { margin:0; overflow:hidden; background:transparent; }'},mixers:0,muted:true});
  // Fit the actual capture resolution into the 1824x840 viewport, preserving aspect ratio.
  const monitorItem=item('Capture — Monitor '+n,1,48,136,1);
  Object.assign(monitorItem,{bounds_type:2,bounds_align:0,bounds:{x:1824,y:840},crop_to_bounds:false});
  c.sources.push({name,id:'scene',versioned_id:'scene',settings:{id_counter:3,items:[monitorItem,item(graphic,2)]}});
 }
}
// Microphone isolated from desktop sound; muted until local sound check.
c.sources.push({name:'MIC — SteelSeries Sonar',id:'wasapi_input_capture',versioned_id:'wasapi_input_capture',settings:{device_id:'{0.0.1.00000000}.{67c4bdb9-e30e-4795-b45c-f8d79e0dd40e}',use_device_timing:true},volume:1,muted:true,mixers:3,monitoring_type:0});
// Discord-only application capture: no visual chat source. Bind when Discord runs.
c.sources.push({name:'GUESTS — Discord',id:'wasapi_process_output_capture',versioned_id:'wasapi_process_output_capture',settings:{window:'Discord:Chrome_WidgetWin_1:Discord.exe',priority:2},volume:1,muted:true,mixers:5,monitoring_type:0});
for(const scene of c.sources.filter(s=>s.id==='scene'&&(/^(Coding|Nori Demo)/.test(s.name)||s.name==='Discord Community'))){scene.settings.items.push(item('MIC — SteelSeries Sonar',10),item('GUESTS — Discord',11));scene.settings.id_counter=11}
c.scene_order=['Starting Soon','Coding — Monitor 1','Coding — Monitor 2','Nori Demo — Monitor 1','Nori Demo — Monitor 2','Coding','Nori Demo','Discord Community','Break','Ending'].map(name=>({name}));
fs.writeFileSync(path.join(root,'obs/Nori-Animated-Monitors.json'),JSON.stringify(c,null,2));
console.log('Created animated 10-scene monitor collection, mic and Discord controls.');
