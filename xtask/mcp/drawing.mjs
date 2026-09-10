import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {Client} from '../../mcp-server/client.mjs';
const option=n=>process.argv.includes(n)?process.argv[process.argv.indexOf(n)+1]:undefined;
assert(option('--server'),'Use --server MCP_EXE [--desktop CAD_EXE] [--save FILE] [--out REPORT]');
const c=new Client(option('--server'));const report={operations:[]};let session;
const call=async(name,args={})=>{const result=await c.call(name,args);report.operations.push({name,arguments:args});return result;};
try{
 await c.start();
 if(option('--desktop')){const launched=await call('cad_interface',{action:'launch',executable:option('--desktop')});assert.equal(launched.status,'ready');session=launched.session_id;report.pid=launched.pid;report.session_id=session;}
 assert.equal((await call('solid_scene')).bodies.length,0,'Drawing lesson requires an empty document');
 await call('sketch_begin',{plane:{type:'origin_plane',plane:'xy'}});
 await call('sketch_add_rectangle_locked',{mode:'two_point',anchor:{x:0,y:0},corner_hint:{x:40,y:25},width_mm:40,height_mm:25,ctrl_held:true});
 await call('sketch_finish');
 const model=JSON.parse(await call('cad_project_model'));
 await call('solid_extrude',{sketch_name:model.sketches.at(-1).name,profile_indices:[0],operation:'new_body',extent:{type:'distance',distance:6},taper_angle_deg:0,flip:false,target_body_ids:[]});
 const stock=await call('cad_document');
 const doc=await call('drawing_create_sheet',{name:'Bracket stock — fabrication',format:'a4',orientation:'landscape',title_block:{title:'Parametric bracket stock',drawing_number:'GOLDEN-001',revision:'A'}});
 const sheet=doc.active_sheet_id;
 for(const [name,kind,direction,up,position]of [['Top','top',[0,0,1],[0,1,0],[80,65]],['Front','front',[0,-1,0],[0,0,1],[80,125]],['Isometric','isometric',[1,-1,1],[0,0,1],[185,80]]]){
   const result=await call('drawing_add_view',{sheet_id:sheet,view:{name,kind,direction,up,position,scale:2,show_hidden_lines:true}});
   assert.equal(result.active_sheet_id,sheet);
   const projection=await call('drawing_projection',{direction,up,include_hidden:true});
   assert(projection.visible.length>0,'Exact projection must contain linework');assert(projection.anchors.length>0,'Projection must expose associative topology');
   if(kind==='top'){assert(Math.abs(projection.bounds[2]-projection.bounds[0]-40)<0.01);assert(Math.abs(projection.bounds[3]-projection.bounds[1]-25)<0.01);}
 }
 const front=(await call('drawing_document')).sheets[0].views.find(v=>v.kind==='front');
 const projectionArgs={direction:front.direction,up:front.up,include_hidden:true};
 const projected=await call('drawing_projection',projectionArgs);
 const pair=projected.anchors.flatMap(a=>projected.anchors.filter(b=>a.edge_id===b.edge_id&&a.endpoint!==b.endpoint&&Math.abs(a.model_point[2]-b.model_point[2])>5.99).map(b=>[a,b]))[0];
 assert(pair,'Find thickness edge from actual topology');
 const ref=a=>({body_id:a.body_id,edge_id:a.edge_id,edge_key:a.edge_key,endpoint:a.endpoint,fallback_point:a.model_point});
 const dimension={sheet_id:sheet,view_id:front.id,first:ref(pair[0]),second:ref(pair[1]),mode:'vertical',offset:12,presentation:{tolerance:{mode:'symmetric',upper:0.2,lower:0.2}}};
 const untouched=await call('drawing_document');
 for(const bad of [{...dimension,view_id:999},{...dimension,first:{...dimension.first,edge_key:'stale'}},{...dimension,second:{...dimension.first,fallback_point:[99,99,99]}},{...dimension,precision:7},{...dimension,first:{...dimension.first,body_id:999}},{...dimension,first:{...dimension.first,circle_center:true}}]){
  const result=await c.rpc('tools/call',{name:'drawing_add_linear_dimension',arguments:bad});assert(result.isError);assert.deepEqual(await call('drawing_document'),untouched,'Rejected dimension must preserve IDs/history');
 }
 await call('drawing_add_linear_dimension',dimension);
 const feature=stock.features.find(f=>f.kind==='extrude');
 assert(feature,'Native extrusion feature exists');
 await call('solid_edit_extrude',{feature_id:feature.id,extrude:{sketch_name:model.sketches.at(-1).name,profile_indices:[0],operation:'new_body',extent:{type:'distance',distance:8},taper_angle_deg:0,flip:false,target_body_ids:[]}});
 const changed=await call('drawing_projection',projectionArgs);
 const resolve=r=>changed.anchors.find(a=>a.body_id===r.body_id&&a.edge_key===r.edge_key&&a.endpoint===r.endpoint);
 const annotation=(await call('drawing_document')).sheets[0].annotations[0];
 assert.equal(annotation.kind,'linear_dimension');
 assert.equal(annotation.presentation.tolerance.upper,0.2);
 assert(Math.abs(resolve(annotation.first).model_point[2]-resolve(annotation.second).model_point[2])===8,'Dimension must follow edited thickness using topology, not fallback points');
 await call('drawing_add_note',{sheet_id:sheet,text:'DEBURR ALL EDGES. DIMENSIONS IN mm.',position:[25,175]});
 const before=await call('drawing_document');
 const invalid=await c.rpc('tools/call',{name:'drawing_add_view',arguments:{sheet_id:sheet,view:{name:'Invalid',kind:'top',direction:[0,0,1],up:[0,1,0],position:[0,0],scale:0}}});
 assert(invalid.isError,'Invalid scale must fail');
 assert.deepEqual(await call('drawing_document'),before,'Failed view must leave IDs and document unchanged');
 const scratch=await call('drawing_create_sheet',{name:'Scratch',format:'a4',orientation:'portrait'});
 await call('drawing_select_sheet',{sheet_id:sheet});await call('drawing_delete_sheet',{sheet_id:scratch.active_sheet_id});
 const final=await call('drawing_document');assert.equal(final.sheets.length,1);assert.equal(final.sheets[0].views.length,3);assert.equal(final.sheets[0].annotations.length,2);
 if(session){
  const ui=await call('cad_interface',{action:'inspect'});assert(ui.ui.canvases.some(c=>c.name==='drawing'),'Live renderer must display the drawing');
  if(option('--save')){assert.equal((await call('cad_interface',{action:'file',command:'save',path:option('--save')})).status,'applied');
   const opened=await call('cad_interface',{action:'file',command:'open',path:option('--save')});assert.equal(opened.status,'applied');report.session_id=opened.active_session_id;
   assert.deepEqual(await call('drawing_document'),final,'Native reopen must preserve dimensions and tolerance metadata');
  }
 }
 const persisted=await call('cad_project_model');const restored=new Client(option('--server'));
 try{await restored.start();await restored.call('cad_load_project_model',{model_json:persisted});assert.deepEqual(await restored.call('drawing_document'),await call('drawing_document'));}finally{restored.close();}
 report.status='passed';console.log('PASS drawing: native stock, sheet, 3 exact projections, associative thickness dimension 6 to 8 mm, note, rejected edits, selection/deletion and fresh-process restore');
}catch(error){report.status='failed';report.error=String(error);throw error;}finally{if(option('--out'))await writeFile(option('--out'),JSON.stringify(report,null,2));c.close();}
