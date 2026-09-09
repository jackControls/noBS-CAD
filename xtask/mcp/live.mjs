import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {Client} from '../../mcp-server/client.mjs';

const option = name => process.argv[process.argv.indexOf(name) + 1];
assert(process.argv.includes('--server') && (process.argv.includes('--desktop') || process.argv.includes('--session')),
  'Use --server MCP_EXE --desktop CAD_EXE [--pace 0..2000] [--out report.json]');
const client = new Client(option('--server'));
const report = {operations: []};
async function call(name, args = {}) {
  const start = performance.now();
  const result = await client.call(name, args);
  report.operations.push({name, arguments: args, elapsed_ms: Math.round(performance.now() - start), result});
  console.log(name, result.status ?? 'ok');
  return result;
}
try {
  await client.start();
  const launch = process.argv.includes('--session') ? {status:'ready',session_id:option('--session')} : await call('cad_interface', {action:'launch',executable: option('--desktop')});
  assert.equal(launch.status, 'ready', JSON.stringify(launch));
  if(process.argv.includes('--desktop')) assert.equal(launch.attached,true,'Launch must bind the new desktop without another routing step');
  report.session_id = launch.session_id;
  report.pid = launch.pid;
  let activeSession = launch.session_id;
  const ui = async args => {
    const result = await call('cad_interface', {session_id: activeSession, ...args});
    activeSession = result.active_session_id ?? activeSession;
    return result;
  };
  await ui({action: 'inspect', pace_ms: process.argv.includes('--pace') ? Number(option('--pace')) : 0});
  for (const mode of ['background', 'foreground']) {
    const window = await ui({action: 'window', mode});
    assert.equal(window.status, 'applied', JSON.stringify(window));
    assert.equal(window.window.minimized, mode === 'background');
    if (mode === 'background' && process.argv.includes('--idle')) {
      await new Promise(resolve=>setTimeout(resolve,35000));
    }
    const view = await call('cad_interface', {action:'view',session_id: launch.session_id, view: 'top'});
    assert.equal(view.status, 'applied', JSON.stringify(view));
    const offset = view.camera.position.map((v, i) => v - view.camera.target[i]);
    assert(offset[2] > 0 && Math.hypot(offset[0], offset[1]) < 1e-5);
  }
  const snapshot = await ui({action: 'inspect'});
  assert.equal(snapshot.status, 'applied');
  assert(snapshot.ui.surfaces.length > 0);
  const disabled = snapshot.ui.surfaces.flatMap(s=>s.controls).find(c=>c.disabled);
  if (disabled) assert.equal((await ui({action:'click',target:disabled.id})).status,'failed');
  await ui({action:'inspect'});
  assert.equal((await ui({action:'click',target:snapshot.ui.surfaces[0].controls[0].id})).status,'failed','Previous snapshot IDs must be rejected');
  console.log('UI surfaces:', snapshot.ui.surfaces.map(s => s.name).join(', '));
  console.log('Unlabeled controls:', JSON.stringify(snapshot.ui.unlabeled_controls));
  if (process.argv.includes('--part')) {
    await call('cad_attach', {session_id: launch.session_id});
    const original = JSON.parse(await call('cad_project_model'));
    assert.equal(original.document.history.features.length, 0, 'Part demo requires a new empty document');
    const plan = [
      {name:'sketch_begin',arguments:{plane:{type:'origin_plane',plane:'xy'}}},
      {name:'sketch_add_rectangle_locked',arguments:{mode:'two_point',anchor:{x:-30,y:-20},corner_hint:{x:30,y:20},width_mm:60,height_mm:40,ctrl_held:true}},
      {name:'sketch_finish',arguments:{}},
    ];
    for (const step of plan) {
      await call(step.name, step.arguments);
      const state = await ui({action:'inspect'});
      assert.equal(state.state.mode, step.name === 'sketch_finish' ? 'solid' : 'sketch', 'UI must follow the engine sketch lifecycle');
    }
    // Finish refreshed a model that already contains the sketch. Its portable
    // script must not append another finish (or any desktop transport call).
    await call('cad_detach');
    const replay = new Client(option('--server'));
    try {
      const script = await call('cad_script');
      assert(!script.calls.some(step=>step.name==='cad_interface'));
      await replay.start();
      for (const step of script.calls) await replay.call(step.name,step.arguments);
      const restored = JSON.parse(await replay.call('cad_project_model'));
      assert.equal(restored.sketches.length,1,'Live script must replay each edit exactly once');
    } finally {
      replay.close();
      await call('cad_attach',{session_id:activeSession});
    }
    const current = await ui({action:'inspect'});
    const extrude = current.ui.surfaces.flatMap(s=>s.controls).find(c=>c.label==='Extrude'&&!c.disabled);
    assert(extrude, 'Extrude UI is unavailable after native sketch');
    const dialog = await ui({action:'click',target:extrude.id});
    assert.equal(dialog.status,'applied');
    console.log('Extrude dialog:', JSON.stringify(dialog.ui.surfaces.filter(s=>s.name.startsWith('dialogs/'))));
    async function control(label, action='click', value) {
      const current = await ui({action:'inspect'});
      const matches = current.ui.surfaces.flatMap(s=>s.controls).filter(c=>c.label===label&&!c.disabled);
      assert.equal(matches.length,1,`Expected one enabled ${label} control`);
      const result = await ui({action,target:matches[0].id,...(value===undefined?{}:{value})});
      assert.equal(result.status,'applied',JSON.stringify(result));
      return result;
    }
    const distance = await control('Distance','set_value','5');
    assert(distance.ui.surfaces.flatMap(s=>s.controls).some(c=>c.label==='Distance'&&c.value==='5'));
    assert.equal((await ui({action:'viewport',world:[0,0,0]})).status,'applied');
    await control('OK');
    await call('cad_refresh');
    const model = JSON.parse(await call('cad_project_model'));
    assert.equal(model.sketches.length,1);
    assert(model.document.history.features.some(f=>f.kind==='extrude'),'UI must commit a native extrude feature');
    const scene = await call('solid_scene');
    assert.equal(scene.bodies.length,1);
    assert.equal(scene.errors.length,0);
    const z = scene.bodies[0].mesh.positions.filter((_,i)=>i%3===2);
    assert(Math.abs(Math.max(...z)-Math.min(...z)-5)<1e-5,'React field change must affect the resulting solid');
    if (process.argv.includes('--drawing')) {
      await control('Switch workspace'); await control('Drawing'); await control('Create blank sheet');
      await control('Front View');
      const sheet = (await ui({action:'inspect'})).ui.canvases.find(c=>c.name==='drawing');
      assert(sheet,'Drawing canvas must expose its bounds');
      assert.equal((await ui({action:'viewport',canvas:'drawing',point:[sheet.x+sheet.width*0.35,sheet.y+sheet.height*0.4]})).status,'applied');
      await call('cad_refresh');
      const drawingModel = JSON.parse(await call('cad_project_model'));
      assert.equal(drawingModel.drawings.sheets[0].views.length,1,'UI placement must create an actual drawing view');
      await control('Switch workspace'); await control('Solid Modeling');
    }
    if (process.argv.includes('--save')) {
      const saved = await ui({action:'file',command:'save',path:option('--save')});
      assert.equal(saved.status,'applied',JSON.stringify(saved));
      const overwrite = await ui({action:'file',command:'save',path:option('--save')});
      assert.equal(overwrite.status,'failed','Existing file must require explicit overwrite');
      const opened = await ui({action:'file',command:'open',path:option('--save')});
      assert.equal(opened.status,'applied',JSON.stringify(opened));
      assert.equal(opened.attached_session_id,opened.active_session_id,'File transitions must bind subsequent operations automatically');
      assert.equal((await call('solid_scene')).bodies.length,1,'Operation reads must follow the reopened document without another attach');
      assert.equal((await ui({action:'inspect'})).status,'applied','Continue driving the session after open');
    }
  }
  report.status='passed';
  console.log('PASS live MCP UI golden');
} catch(error) {
  report.status='failed';report.error=String(error);throw error;
} finally {
  if (process.argv.includes('--out')) await writeFile(option('--out'), JSON.stringify(report, null, 2));
  client.close();
}
