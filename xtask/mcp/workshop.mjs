import assert from 'node:assert/strict';

/** Small joinery/tooling studies accompany the finished bench. Each starts
 * from a checkpoint so destructive teaching operations cannot ruin the bench.
 * Coverage comes from successful MCP calls, never a hand-maintained tool count.
 */
export async function workshop(call, empty, report) {
  const reset=()=>call('cad_load_project_model',{model_json:empty});
  const active=()=>call('sketch_active');
  const begin=async()=>{await reset();await call('sketch_begin',{plane:{type:'origin_plane',plane:'xy'}});await call('sketch_set_grid_snap',{enabled:false});};
  const line=async(a,b)=>{await call('sketch_add_line',{from:{x:a[0],y:a[1]},to_raw:{x:b[0],y:b[1]},ctrl_held:true});return (await active()).entities.filter(e=>e.kind==='line').at(-1).id;};
  const circle=async()=>{await call('sketch_add_circle',{mode:'center_diameter',p1:{x:0,y:0},p2:{x:10,y:0},ctrl_held:true});return (await active()).entities.find(e=>e.kind==='circle').id;};
  const check=async(name,run)=>{await run();report.checks.push(name);console.log('PASS workshop',name);};
  await check('sketch primitives and dimensioned layout',async()=>{
    await begin();await call('sketch_set_grid_step',{step_mm:5});await call('sketch_set_dimension_style',{style:'iso'});
    await call('sketch_eval_expression',{text:'1200 / 5'});
    await call('sketch_preview_line',{from:{x:0,y:0},to_raw:{x:20,y:0},ctrl_held:true});
    await call('sketch_preview_line_locked',{from:{x:0,y:0},to_hint:{x:20,y:0},length_mm:20,ctrl_held:true});
    await call('sketch_add_line_locked',{from:{x:0,y:0},to_hint:{x:20,y:0},length_mm:20,ctrl_held:true});
    await call('sketch_add_midpoint_line',{mid_raw:{x:50,y:0},end_raw:{x:60,y:0},ctrl_held:true});
    await call('sketch_add_point',{position:{x:80,y:0}});
    const point=(await active()).entities.filter(e=>e.kind==='point').at(-1).id;
    await call('sketch_move_point',{point_id:point,to_raw:{x:85,y:5},ctrl_held:true,phase:'single'});
    await call('sketch_toggle_fix',{entity_ids:[point]});await call('sketch_toggle_fix',{entity_ids:[point]});
    await call('sketch_delete_entities',{entity_ids:[point]});await call('sketch_undo');await call('sketch_redo');
    assert(!(await active()).entities.some(e=>e.id===point));
    await call('sketch_add_rectangle',{mode:'center',p1:{x:30,y:40},p2:{x:40,y:50},ctrl_held:true});
    await call('sketch_add_rectangle_locked',{mode:'two_point',anchor:{x:60,y:30},corner_hint:{x:80,y:50},width_mm:20,height_mm:20,ctrl_held:true});
    await call('sketch_add_circle',{mode:'two_point',p1:{x:100,y:30},p2:{x:120,y:30},ctrl_held:true});
    await call('sketch_add_circle_locked',{mode:'center_diameter',anchor:{x:150,y:40},edge_hint:{x:160,y:40},diameter_mm:20,ctrl_held:true});
    await call('sketch_add_arc_3pt',{p1:{x:0,y:80},p2:{x:20,y:80},p3:{x:10,y:90},ctrl_held:true});
    await call('sketch_add_arc_center',{center:{x:50,y:80},start:{x:60,y:80},sweep:{x:50,y:90},ctrl_held:true});
    for(const [i,mode] of ['center_to_center','overall','center_point'].entries()) await call('sketch_add_slot',{mode,p1:{x:90+i*40,y:80},p2:{x:110+i*40,y:80},cursor:{x:100+i*40,y:85},width_mm:10});
    await call('sketch_add_spline',{points:[{x:0,y:120},{x:20,y:135},{x:40,y:120}]});
    await call('sketch_polygon',{center:{x:80,y:120},edge_count:6,radius_text:'12',rotation_deg:0,mode:'inscribed'});
    assert((await active()).entities.length>30);
    await call('sketch_finish');await call('sketch_finished');await call('sketch_profiles');await call('sketch_edit',{name:'Sketch1'});await call('sketch_finish');
  });
  await check('driving dimensions and geometric constraints',async()=>{
    await begin();const id=await line([0,0],[20,0]);
    await call('sketch_add_constraint',{type:'horizontal',entity:id});
    const second=await line([0,20],[20,20]);await call('sketch_add_constraints',{constraints:[{type:'horizontal',entity:second},{type:'equal',a:id,b:second}]});
    await call('sketch_add_dimension',{entities:[id],text_pos:{x:10,y:-10},value_text:'20'});
    const dimension=(await active()).dimensions.at(-1).constraint_id;
    await call('sketch_edit_dimension',{constraint_id:dimension,text:'25'});await call('sketch_move_dimension',{constraint_id:dimension,text_pos:{x:12,y:-15}});
    const measured=(await active()).entities.find(e=>e.id===id);assert(Math.abs(Math.hypot(measured.end.x-measured.start.x,measured.end.y-measured.start.y)-25)<1e-5);
    await call('sketch_delete_dimension',{constraint_id:dimension});
  });
  for(const operation of ['fillet','chamfer']) await check(`sketch ${operation} joinery corner`,async()=>{
    await begin();const l1=await line([0,0],[30,0]);const l2=await line([0,0],[0,30]);
    if(operation==='fillet')await call('sketch_preview_fillet',{l1,l2,radius_text:'4'});
    await call(`sketch_${operation}`,operation==='fillet'?{l1,l2,radius_text:'4'}:{l1,l2,distance_text:'4'});
    assert((await active()).entities.filter(e=>e.kind!=='point').length>=3);
  });
  await check('sketch offset and transforms',async()=>{
    await begin();const id=await circle();
    await call('sketch_preview_offset',{entity:id,distance_text:'2',cursor:{x:15,y:0}});await call('sketch_offset',{entity:id,distance_text:'2',cursor:{x:15,y:0}});
    const axis=await line([30,-30],[30,30]);await call('sketch_mirror',{entity_ids:[id],axis_line:axis});
    await call('sketch_move_copy',{entity_ids:[id],dx:0,dy:40,copy:true});await call('sketch_scale',{entity_ids:[id],origin:{x:0,y:0},factor_text:'1.2'});
    await call('sketch_rectangular_pattern',{entity_ids:[id],direction:{x:1,y:0},spacing:50,count:3});
    await call('sketch_circular_pattern',{entity_ids:[id],center:{x:0,y:100},count:3,total_angle_deg:180});
    assert((await active()).entities.filter(e=>e.kind==='circle').length>=7);
  });
  await check('sketch trim, extend and break',async()=>{
    await begin();const id=await line([0,0],[30,0]);await line([10,-10],[10,10]);await line([20,-10],[20,10]);
    await call('sketch_preview_trim',{entity:id,click:{x:15,y:0}});await call('sketch_trim',{entity:id,click:{x:15,y:0}});
    await begin();const short=await line([0,0],[10,0]);await line([20,-10],[20,10]);await call('sketch_extend',{entity:short,click:{x:9,y:0}});
    await call('sketch_break',{entity:short,at:{x:5,y:0}});assert((await active()).entities.filter(e=>e.kind==='line').length===3);
  });
  await reset();
  const stock=async()=>{
    await reset();await call('sketch_begin',{plane:{type:'origin_plane',plane:'xy'}});
    await call('sketch_add_rectangle',{mode:'two_point',p1:{x:-10,y:-10},p2:{x:10,y:10},ctrl_held:true});await call('sketch_finish');
    await call('solid_extrude',{sketch_name:'Sketch1',profile_indices:[0],operation:'new_body',extent:{type:'distance',distance:20},taper_angle_deg:0,flip:false,target_body_ids:[]});
    return (await call('solid_scene')).bodies[0];
  };
  const feature=async(name,args,expectedBodies)=>{
    await call(name,args);const made=JSON.parse(await call('cad_project_model')).document.history.features;
    await call(name.replace('solid_','solid_edit_'),{feature_id:made.at(-1).id,request:args});
    const edited=JSON.parse(await call('cad_project_model')).document.history.features;assert.equal(edited.length,made.length,'Editing must not append history');
    const scene=await call('solid_scene');assert.equal(scene.errors.length,0);assert.equal(scene.bodies.length,expectedBodies);
    assert(scene.bodies.every(b=>b.mesh.positions.length>0));
  };
  await check('shell tooling tray and edit',async()=>{const b=await stock();await feature('solid_shell',{body_id:b.id,face_ids:[b.faces.find(f=>f.plane?.normal[2]>0.99).id],thickness:2,inward:true},1);});
  await check('move/copy and edit',async()=>{const b=await stock();await feature('solid_move_copy',{body_ids:[b.id],translation:{x:30,y:0,z:0},rotation:[0,0,0,1],pivot:{x:0,y:0,z:0},copy:true},2);});
  await check('mirror and edit',async()=>{const b=await stock();await feature('solid_mirror',{body_ids:[b.id],plane:{type:'origin_plane',plane:'yz'}},2);});
  await check('rectangular pattern and edit',async()=>{const b=await stock();await feature('solid_rectangular_pattern',{body_ids:[b.id],direction:{x:1,y:0,z:0},spacing:30,count:3,second_direction:null,second_spacing:0,second_count:1},3);});
  await check('circular pattern and edit',async()=>{const b=await stock();await feature('solid_circular_pattern',{body_ids:[b.id],axis_origin:{x:50,y:0,z:0},axis_direction:{x:0,y:0,z:1},count:4,total_angle_deg:360},4);});
  await check('split joinery blank and edit',async()=>{const b=await stock();await call('construction_plane_offset',{reference:{type:'origin_plane',plane:'xy'},distance:10});const planes=await call('construction_plane_definitions');await feature('solid_split_body',{body_id:b.id,plane:{type:'datum_plane',datum_id:planes[0].datum_id}},2);});
  for(const operation of ['join','cut','intersect'])await check(`boolean ${operation} and edit`,async()=>{
    const b=await stock();await call('solid_move_copy',{body_ids:[b.id],translation:{x:10,y:0,z:0},pivot:{x:0,y:0,z:0},copy:true});
    const bodies=(await call('solid_scene')).bodies;await feature('solid_combine',{target_body_id:b.id,tool_body_ids:[bodies.find(p=>p.id!==b.id).id],operation,keep_tools:false},1);
  });
  await reset();
}
