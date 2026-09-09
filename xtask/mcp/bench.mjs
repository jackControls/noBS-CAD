import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Client} from './client.mjs';
import {workshop} from './workshop.mjs';

const option=name=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:undefined;
assert(option('--server'),'cargo xtask test-mcp bench --server MCP_EXE [--session UUID] [--out DIRECTORY]');
const client=new Client(option('--server'));
const session=option('--session');
const report={name:'Garden workshop bench',calls:[],parts:[],checks:[]};
let tools;
async function call(name,args={}) {
  const start=performance.now();let result;
  const mutate=tools?.find(t=>t.name===name);
  const readOnly=/^(sketch_(active|finished|profiles|preview_.*|eval_expression)|solid_(scene|.*_definitions|export_.*|tessellate)|assembly_(document|solution))$/;
  if(session&&mutate&&mutate.execution!=='control'&&!readOnly.test(name)) {
    const sessions=await client.call('cad_list_sessions');
    const generation=sessions.session_details.find(s=>s.session_id===session).heartbeat.generation;
    const submitted=await client.call('cad_submit',{name,arguments:args,base_generation:generation});
    const applied=await client.call('cad_await_apply',{seq:submitted.seq,timeout_ms:20000});
    assert.equal(applied.status,'applied',JSON.stringify(applied));
    result=applied;
  } else result=await client.call(name,args);
  report.calls.push({name,arguments:args,elapsed_ms:Math.round(performance.now()-start)});
  return result;
}
const model=async()=>JSON.parse(await call('cad_project_model'));
const scene=()=>call('solid_scene');
async function board(name,width,depth,height) {
  const before=await scene();
  await call('sketch_begin',{plane:{type:'origin_plane',plane:'xy'}});
  await call('sketch_add_rectangle_locked',{mode:'two_point',anchor:{x:0,y:0},corner_hint:{x:width,y:depth},width_mm:width,height_mm:depth,ctrl_held:true});
  await call('sketch_finish');
  const sketch=(await model()).sketches.at(-1).name;
  await call('solid_extrude',{sketch_name:sketch,profile_indices:[0],operation:'new_body',extent:{type:'distance',distance:height},taper_angle_deg:0,flip:false,target_body_ids:[]});
  const body=(await scene()).bodies.find(b=>!before.bodies.some(old=>old.id===b.id));
  assert(body,`${name} must create a body`);
  await call('assembly_create_component',{name,body_ids:[body.id],absorb_promoted_bodies:true});
  const assembly=await call('assembly_document');
  const component=assembly.component_structure.definitions.find(c=>c.name===name);
  const occurrence=assembly.component_structure.occurrences.find(o=>o.component_id===component.id);
  const part={name,width,depth,height,body,component,occurrence};report.parts.push({name,width,depth,height});return part;
}
function connector(part,top,origin) {
  const face=part.body.faces.find(f=>f.plane&&f.plane.normal[2]*(top?1:-1)>0.99);
  assert(face,`${part.name} horizontal connector face`);
  return {body_id:part.body.id,face_id:face.id,face_key:face.key,kind:'planar_face',
    frame:{origin,primary_axis:face.plane.normal,secondary_axis:[1,0,0]},
    source_surface_frame:{origin:face.plane.origin,primary_axis:face.plane.normal,secondary_axis:face.plane.u}};
}
try {
  await client.start();tools=await client.call('cad_list_all_tools');
  if(session){await client.call('cad_attach',{session_id:session});await call('cad_ui',{action:'inspect',session_id:session,pace_ms:Number(option('--pace')??0)});}
  assert.equal((await model()).document.history.features.length,0,'Use a new empty document for the bench');
  if(option('--workshop')==='all') await workshop(call,JSON.stringify(await model()),report);
  const slat=await board('Seat slat',1200,85,35);
  await call('assembly_set_occurrence_pose',{occurrence_id:slat.occurrence.id,local_pose:{translation:[0,0,415],rotation:[0,0,0,1]}});
  await call('assembly_set_occurrence_grounded',{occurrence_id:slat.occurrence.id,grounded:true});
  let jointCount=0;
  async function place(part,positions,topOfPart,sameFace=false,skipFirst=false){
    for(const [i,[x,y]] of positions.entries()) {
      if(skipFirst&&i===0)continue;
      let occurrence=part.occurrence;
      if(i>0) {
        const before=await call('assembly_document');
        await call('assembly_create_occurrence',{component_id:part.component.id,name:`${part.name} ${i+1}`});
        occurrence=(await call('assembly_document')).component_structure.occurrences.find(o=>!before.component_structure.occurrences.some(old=>old.id===o.id));
      }
      await call('assembly_create_joint',{name:`${part.name} mount ${i+1}`,kind:'rigid',
        connector_a:connector(slat,sameFace,[x,y,sameFace?35:0]),connector_b:connector(part,true,[0,0,part.height]),
        flipped:sameFace,linear_offset_mm:topOfPart-(sameFace?450:415),
        grounded_occurrence_id:slat.occurrence.id,
        advanced:{connector_a_occurrence_id:slat.occurrence.id,connector_b_occurrence_id:occurrence.id}});
      jointCount++;
    }
  }
  await place(slat,[[0,0],[0,90],[0,180],[0,270],[0,360]],450,true,true);
  const leg=await board('Leg',60,60,415);await place(leg,[[60,35],[1080,35],[60,340],[1080,340]],415);
  const apron=await board('Long apron',1080,25,90);await place(apron,[[60,50],[60,365]],415);
  const rail=await board('Side rail',25,305,90);await place(rail,[[78,60],[1097,60]],415);
  const post=await board('Back post',50,40,740);await place(post,[[65,405],[1085,405]],740,true);
  const back=await board('Back board',1200,25,85);await place(back,[[0,425]],635,true);
  const upper=await board('Upper back board',1200,25,85);await place(upper,[[0,425]],740,true);
  const assembly=await call('assembly_document');const solved=await call('assembly_solution');
  assert.equal(solved.solved,true);assert.equal(solved.diagnostics.length,0,JSON.stringify(solved.diagnostics));
  assert.equal(assembly.joints.length,jointCount);
  assert.equal(assembly.component_structure.occurrences.length,jointCount+1);
  const original=await model();assert(original.sketches.length===report.parts.length);
  assert(!original.document.history.features.some(f=>f.kind==='import_step'));
  await call('solid_recompute');
  assert.equal((await scene()).errors.length,0);
  report.checks.push('native sketch/extrude provenance','repeated component occurrences','rigid joint solution','history replay');
  if(session) await call('cad_ui',{action:'view',session_id:session,view:'isometric',fit:true});
  if(option('--out')) {
    const out=resolve(option('--out'));await mkdir(out,{recursive:true});
    await writeFile(resolve(out,'bench.model.json'),JSON.stringify(await model(),null,2));
    await writeFile(resolve(out,'bench-report.json'),JSON.stringify(report,null,2));
  }
  console.log(`PASS bench: ${report.parts.length} native parts, ${jointCount+1} occurrences, ${jointCount} rigid joints`);
} finally {client.close();}
