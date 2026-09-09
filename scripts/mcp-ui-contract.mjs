import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';

const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,entries:[]},server:{host:'127.0.0.1',port:0},logLevel:'error',plugins:[{name:'mcp-contract',configureServer(server){server.middlewares.use('/mcp-contract',(_req,res)=>{
 res.setHeader('Content-Type','text/html');
 res.end('<!doctype html><html><body><main data-mcp-surface="test-surface"><button>Run</button><button disabled>Disabled</button><label>Name<input value="old"></label><label>Choice<select><option value="a">A</option><option disabled value="b">B</option></select></label><button id="hidden" hidden>Hidden</button></main></body></html>');
});}}]});
let browser;
try {
 await server.listen();
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage();
 await page.goto(server.resolvedUrls.local[0]+'mcp-contract');
 const result=await page.evaluate(async()=>{
  const {inspectUi,operateUi}=await import('/src/uiControl.ts');
  const {SerialPlayback}=await import('/src/mcpPlayback.ts');
  const config=await import('/src/ribbon/config.ts');
  const check=(condition,message)=>{if(!condition)throw new Error(message);};
  const rejects=(fn,pattern)=>{let error;try{fn();}catch(e){error=String(e);}check(error&&pattern.test(error),'Expected rejection '+pattern+', received '+error);};
  const context={document:1};
  const controls=()=>inspectUi(context).surfaces.flatMap(s=>s.controls);
  let list=controls();
  check(list.every(c=>c.surface==='test-surface'),'Controls lost their actual surface grouping');
  check(!list.some(c=>c.label==='Hidden'),'Hidden control advertised');
  check(!inspectUi(context).unlabeled_controls.length,'Labeled controls reported missing labels');
  list=controls();
  rejects(()=>operateUi({action:'click',target:list.find(c=>c.label==='Disabled').id},context),/disabled/);
  const input=list.find(c=>c.label==='Name');
  let inputEvents=0; document.querySelector('input').addEventListener('input',()=>inputEvents++);
  operateUi({action:'set_value',target:input.id,value:'new'},context);
  check(document.querySelector('input').value==='new'&&inputEvents===1,'Field change did not follow event path');
  rejects(()=>operateUi({action:'set_value',target:list.find(c=>c.label==='Choice').id,value:'b'},context),/unavailable/);
  const old=list.find(c=>c.label==='Run').id;
  controls();
  rejects(()=>operateUi({action:'click',target:old},context),/stale/);
  list=controls();
  rejects(()=>operateUi({action:'click',target:list.find(c=>c.label==='Run').id},{}),/Document changed/);
  const run=list.find(c=>c.label==='Run');
  document.querySelector('button').textContent='Different action';
  rejects(()=>operateUi({action:'click',target:run.id},context),/Control changed/);
  const modal=document.createElement('div'); modal.setAttribute('aria-modal','true'); modal.innerHTML='<button>Accept</button>'; document.body.append(modal);
  list=controls();
  rejects(()=>operateUi({action:'click',target:list.find(c=>c.label==='Different action').id},context),/modal/);
  let accepted=false; modal.querySelector('button').onclick=()=>{accepted=true;};
  operateUi({action:'click',target:list.find(c=>c.label==='Accept').id},context);
  check(accepted,'Modal control did not execute');
  const playback=new SerialPlayback();
  const events=[]; let release;
  const first=playback.tick(async()=>{events.push('start');await new Promise(r=>release=r);events.push('finish');});
  check(await playback.tick(async()=>events.push('overlap'))===false,'Playback admitted overlapping work');
  release();await first;
  try{await playback.tick(async()=>{throw new Error('expected');});}catch{}
  check(await playback.tick(async()=>events.push('recovered')),'Playback remained wedged after failure');
  check(events.join(',')==='start,finish,recovered','Playback ordering changed');
  // Derived from the product configuration: new enabled commands automatically
  // enter this check, rather than requiring a copied inventory or count update.
  let commands=0;
  for(const tab of [config.SOLID_TAB,config.SKETCH_TAB,config.DRAWING_TAB,config.ASSEMBLY_TAB]){
   const walk=(entries)=>{for(const entry of entries){if(entry.type==='separator')continue;
    if(entry.enabled===true&&!entry.children){check(Boolean(entry.action),`Enabled UI command has no dispatch action: ${tab.id}/${entry.id}`);commands++;}
    if(entry.children)walk(entry.children);
   }};
   for(const panel of tab.panels){walk(panel.buttons);walk(panel.menu??[]);}
  }
  return {commands,checks:['grouping','hidden','disabled','field-events','unavailable-option','stale-snapshot','document-change','recycled-control','modal','serial-order','failure-recovery','product-command-coverage']};
 });
 assert(result.commands>0);
 console.log('PASS MCP UI contracts: '+JSON.stringify(result));
} finally {await browser?.close();await server.close();}


