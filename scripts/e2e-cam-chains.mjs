/** Real kernel, Rust resolver, viewport picker and associative chamfer generation. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
try {
  await page.goto('http://localhost:7199', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__engine && window.__appStore?.getState().document);
  const model = await page.evaluate(async () => {
    const engine = window.__engine, store = window.__appStore.getState();
    const simulate = engine.camSimulate.bind(engine);
    engine.camSimulate = request => simulate({ ...request, voxel_size: 0.5, max_voxels: 40000 });
    store.applySolidUpdate(await engine.newProject());
    await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
    await engine.addRectangle({ mode: 'two_point', p1: { x: 0, y: 0 }, p2: { x: 40, y: 25 }, ctrl_held: true });
    await engine.endSketch();
    const catalog = await engine.profileCatalog();
    let update = await engine.extrude({ source_face: null, sketch_name: catalog[0].sketch_name,
      profile_indices: [catalog[0].profiles[0].index], operation: 'new_body',
      extent: { type: 'distance', distance: 10 }, taper_angle_deg: 0, flip: true, target_body_ids: [] });
    let body = update.scene.bodies[0];
    const top = body.edges.filter(e => e.points.every(p => Math.abs(p.z) < 1e-6));
    if (top.length !== 4) throw Error('Fixture must expose four top edges.');
    update = await engine.solidChamfer({ body_id: body.id, edge_ids: top.map(e => e.id), distance: 1, tangent_chain: false });
    store.applySolidUpdate(update);
    store.setDocument(update.document); store.setFinishedSketches(await engine.finishedSketches()); store.setMode('solid');
    body = update.scene.bodies[0];
    window.__chainBody = body;
    const cam = await engine.camDocument();
    const cutting = { spindle_rpm: 6000, feed_xy: 600, feed_z: 100, coolant: 'flood' };
    cam.tools = [{ id: 1, number: 1, name: 'Chamfer 6', kind: 'chamfer_mill', diameter: 6, flute_length: 10,
      overall_length: 40, center_cutting: true, flute_count: 3, point_angle_degrees: 90,
      corner_radius: null, cutting, cutting_presets: [], default_step_down: 1, default_step_over: 1 }];
    window.__testChamferTool=cam.tools[0];
    cam.setups = [{ id: 1, name: 'Setup A', wcs: { origin: { x: 0, y: 0, z: 0 }, x_axis: [1,0,0], y_axis: [0,1,0], z_axis: [0,0,1] },
      wcs_origin: { mode: 'explicit' }, work_offset: 'g54', work_offset_count: 1, stock_spec: { mode: 'legacy_box' }, resolved_stock: { shape: 'box' },
      stock: { min: { x: -2, y: -2, z: -12 }, max: { x: 42, y: 27, z: 0.5 } }, stock_model_box: null,
      body_ids: [body.id], operations: [] }];
    cam.active_setup_id = 1; cam.next_setup_id = 2; cam.next_operation_id = 1; cam.next_tool_id = 2;
    await store.setCamDocument(cam);
    store.setSelectedCamSetupId(1); store.setSelectedCamOperationId(null); store.setActiveTab('cam');
    const upper = body.edges.filter(e => e.points.every(p => Math.abs(p.z) < 1e-6));
    const lower = body.edges.filter(e => e.points.every(p => Math.abs(p.z + 1) < 1e-6));
    window.__chainUpper = upper;
    const key = e => `edge:${body.id}:${e.key}`;
    const request = { source: 'model', body_ids: [body.id], normal: [0,0,1], keys: [key(upper[0])], mode: 'closed' };
    const chain = await engine.geometryEdgeChain(request);
    const upperGeometry = await engine.camChamferGeometry({ setup_id: 1, chain_ref: { source: 'model', keys: chain.keys, reversed: false } });
    const lowerChain = await engine.geometryEdgeChain({ ...request, keys: [key(lower[0])] });
    const lowerGeometry = await engine.camChamferGeometry({ setup_id: 1, chain_ref: { source: 'model', keys: lowerChain.keys, reversed: false } });
    const open = await engine.camChamferGeometry({ setup_id: 1, chain_ref: { source: 'model', keys: [key(upper[0])], reversed: false } });
    const reversed = await engine.camChamferGeometry({ setup_id: 1, chain_ref: { source: 'model', keys: [key(upper[0])], reversed: true } });
    window.__chainSavedModel = await engine.exportProjectModel();
    return { chain, upperGeometry, lowerGeometry, open, reversed, faceKeys: body.faces.map(f => f.edge_keys) };
  });
  assert.equal(model.chain.closed, true); assert.equal(model.chain.keys.length, 4);
  for (const g of [model.upperGeometry, model.lowerGeometry]) {
    assert.equal(g.width, 1); assert.equal(g.top_z, 0); assert.equal(g.wall_side, 'inside'); assert.equal(g.closed, true);
  }
  assert.equal(model.open.closed, false); assert.equal(model.open.path.length, 2);
  assert.deepEqual(model.reversed.path, [...model.open.path].reverse());
  assert.notEqual(model.open.wall_side, model.reversed.wall_side);
  assert.ok(model.faceKeys.every(keys => keys.length >= 3));
  await page.evaluate(() => { window.__cameraApi.fit(); window.__cameraApi.snapToDirection([0,0,1]); });
  await page.locator('[data-ribbon-button="camChamfer"]').click();
  const dialog = page.getByTestId('cam-operation-dialog');
  await dialog.getByRole('button', { name: 'Geometry', exact: true }).click();
  await page.waitForFunction(() => window.__appStore.getState().camChainPick?.context);
  await page.waitForFunction(() => { const c=window.__cameraApi.getSnapshot(); return Math.abs(c.position[0]-c.target[0])<1e-7 && Math.abs(c.position[1]-c.target[1])<1e-7; });
  // Click an actual projected edge, not a store-injected selection.
  const point = await page.evaluate(() => {
    const e = window.__chainUpper.find(e => e.points.every(p => Math.abs(p.x - 1) < 1e-6)) ?? window.__chainUpper[0];
    const a = e.points[0], b = e.points.at(-1);
    return window.__cameraApi.worldToScreen([(a.x+b.x)/2, (a.y+b.y)/2, (a.z+b.z)/2]);
  });
  await page.mouse.move(point.x, point.y);
  await page.waitForFunction(() => window.__appStore.getState().camChainPick.hoverKeys?.length === 4);
  await page.mouse.click(point.x, point.y);
  await dialog.getByText(/4 edges · closed chain/).waitFor();
  await dialog.getByText(/Model width 1.000/).waitFor();
  // Incidental document/status echoes must not discard an active pick.
  await page.evaluate(async () => { const s=window.__appStore.getState(); await s.setCamDocument(await window.__engine.camDocument()); });
  await dialog.getByText(/4 edges · closed chain/).waitFor();
  await dialog.getByRole('button', { name: /^Sketch curves/ }).click();
  await page.waitForFunction(() => window.__appStore.getState().camChainPick.context.source === 'sketch');
  await dialog.getByRole('button', { name: /^Model edges/ }).click();
  await dialog.getByText(/4 edges · closed chain/).waitFor();
  await page.screenshot({ path: '/tmp/nbcad-chamfer-chain.png' });
  await dialog.getByRole('button', { name: 'Manual edges', exact: true }).click();
  await dialog.getByRole('button', { name: 'Clear chain selection' }).click();
  await page.mouse.click(point.x, point.y);
  await dialog.getByText(/1 edge · open chain/).waitFor();
  const adjacent = await page.evaluate(() => {
    const state=window.__appStore.getState().camChainPick;
    const edges=state.entities.map(e=>({...e,points:e.modelPoints.map(p=>[p.x,p.y,p.z])}));
    const seed=edges.find(e=>e.key===state.selectedKeys[0]);
    const shared=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]))<1e-6;
    const e=edges.find(e=>e.key!==seed.key && e.points.every(p=>Math.abs(p[2])<1e-6)
      && [e.points[0],e.points.at(-1)].some(p=>[seed.points[0],seed.points.at(-1)].some(q=>shared(p,q))));
    const a=e.points[0],b=e.points.at(-1);
    return window.__cameraApi.worldToScreen(a.map((v,i)=>(v+b[i])/2));
  });
  await page.mouse.click(adjacent.x,adjacent.y);
  await dialog.getByText(/2 edges · open chain/).waitFor();
  await dialog.getByRole('button', {name:'Remove edge 2',exact:true}).click();
  await dialog.getByText(/1 edge · open chain/).waitFor();
  await dialog.getByRole('button', { name: 'Reverse', exact: true }).click();
  await dialog.getByText(/1 edge · open chain/).waitFor();
  await dialog.getByRole('button', { name: 'Closed loop', exact: true }).click();
  await page.mouse.click(point.x, point.y);
  await dialog.getByText(/4 edges · closed chain/).waitFor();
  await dialog.getByRole('button', { name: 'Passes', exact: true }).click();
  assert.equal(await dialog.getByLabel(/^Additional width/).inputValue(), '0.0000');
  await dialog.locator('button[type="submit"]').click();
  try { await dialog.waitFor({ state: 'detached', timeout: 30000 }); }
  catch (e) { throw Error(`${e}\n${await page.locator('body').innerText()}`); }
  let doc = await page.evaluate(() => window.__engine.camDocument());
  assert.equal(doc.setups[0].operations[0].chamfer_width, 1);
  assert.equal(doc.setups[0].operations[0].closed, true);
  assert.equal(doc.setups[0].operations[0].modeled_chamfer.additional_width, 0);
  assert.equal(doc.toolpath_generations.length, 1);
  await page.locator('[data-cam-sort-scope="operations-1"][data-cam-sort-id="1"]').dblclick();
  await dialog.getByRole('button', { name: 'Geometry', exact: true }).click();
  await dialog.getByText(/4 edges · closed chain/).waitFor();
  await dialog.getByText(/Model width 1.000/).waitFor();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  // Explicit-width manual paths retain their own intent and closure on edit.
  await page.locator('[data-ribbon-button="camChamfer"]').click();
  await dialog.getByRole('button', { name: 'Geometry', exact: true }).click();
  await dialog.getByRole('button', { name: 'Manual points', exact: true }).click();
  await dialog.locator('textarea').fill('0,0\n40,0\n40,25\n0,25\n0,0');
  await dialog.getByRole('button', { name: 'Passes', exact: true }).click();
  await dialog.getByLabel(/^Chamfer width/).fill('0.25');
  await dialog.locator('button[type="submit"]').click();
  await dialog.waitFor({state:'detached',timeout:30000});
  doc=await page.evaluate(()=>window.__engine.camDocument());
  const sharp=doc.setups[0].operations.find(op=>op.id===2);
  assert.equal(sharp.closed,true);assert.equal(sharp.modeled_chamfer,null);assert.equal(sharp.chamfer_width,0.25);
  await page.locator('[data-cam-sort-scope="operations-1"][data-cam-sort-id="2"]').dblclick();
  await dialog.getByRole('button', { name: 'Geometry', exact: true }).click();
  const lines=(await dialog.locator('textarea').inputValue()).trim().split('\n');
  assert.equal(lines[0],lines.at(-1));
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const sink=await page.evaluate(async () => {
    const engine=window.__engine,store=window.__appStore.getState(),body=store.solidScene.bodies[0];
    const top=body.faces.find(f=>f.plane && f.plane.normal[2]>0.999 && Math.abs(f.plane.origin[2])<1e-6);
    const p=[20,12.5,0].map((v,i)=>v-top.plane.origin[i]);
    const uv=b=>p.reduce((s,v,i)=>s+v*b[i],0);
    const update=await engine.hole({body_id:body.id,face_id:top.id,position:{x:uv(top.plane.u),y:uv(top.plane.v)},
      positions:[],position_reference:null,diameter:6,extent:{type:'distance',depth:5},style:'countersink',
      countersink_diameter:7,countersink_angle_deg:90,counterbore_diameter:0,counterbore_depth:0,
      bottom_style:'flat',drill_point_angle_deg:118,thread:null,flip:false});
    store.applySolidUpdate(update);
    const next=update.scene.bodies[0],rim=next.edges.find(e=>e.circle?.closed && Math.abs(e.circle.center.z)<1e-6);
    if (!rim) throw Error('Missing analytic countersink rim.');
    const loop=await engine.geometryEdgeChain({source:'model',body_ids:[next.id],normal:[0,0,1],keys:[`edge:${next.id}:${rim.key}`],mode:'closed'});
    const geometry=await engine.camChamferGeometry({setup_id:1,chain_ref:{source:'model',keys:loop.keys,reversed:false}});
    return {edges:loop.keys.length,radius:rim.circle.radius,geometry};
  });
  assert.equal(sink.edges,1);assert.ok(Math.abs(sink.radius-3.5)<1e-7);
  assert.ok(Math.abs(sink.geometry.width-0.5)<1e-7);assert.equal(sink.geometry.wall_side,'outside');
  if (process.env.CAM_REFERENCE) {
    const savedModel = strFromU8(unzipSync(readFileSync(process.env.CAM_REFERENCE))['model.json']);
    const reference = await page.evaluate(async model => {
      const engine=window.__engine, store=window.__appStore.getState();
      const update=await engine.loadProjectModel(model);store.applySolidUpdate(update);
      const cam=await engine.camDocument(), setup=cam.setups[0];
      const body=update.scene.bodies.find(b=>setup.body_ids.includes(b.id));
      window.__chainBody=body;
      const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
      const z=p=>dot([p.x-setup.wcs.origin.x,p.y-setup.wcs.origin.y,p.z-setup.wcs.origin.z],setup.wcs.z_axis);
      const top=body.faces.filter(f=>f.plane && dot(f.plane.normal,setup.wcs.z_axis)>0.99)
        .sort((a,b)=>(b.signature?.area??0)-(a.signature?.area??0))[0];
      const seed=body.edges.find(e=>top.edge_keys.includes(e.key)&&!e.circle?.closed);
      const chain=await engine.geometryEdgeChain({source:'model',body_ids:setup.body_ids,normal:setup.wcs.z_axis,keys:[`edge:${body.id}:${seed.key}`],mode:'closed'});
      window.__referenceChain=chain;
      const geometry=await engine.camChamferGeometry({setup_id:setup.id,chain_ref:{source:'model',keys:chain.keys,reversed:false}});
      const holes=[];
      for (const rim of body.edges.filter(e=>top.edge_keys.includes(e.key)&&e.circle?.closed)) {
        const loop=await engine.geometryEdgeChain({source:'model',body_ids:setup.body_ids,normal:setup.wcs.z_axis,keys:[`edge:${body.id}:${rim.key}`],mode:'closed'});
        const g=await engine.camChamferGeometry({setup_id:setup.id,chain_ref:{source:'model',keys:loop.keys,reversed:false}});
        holes.push({edges:loop.keys.length,width:g.width,wall_side:g.wall_side});
      }
      // Generate this new operation against the real copied stock/WCS. Keep
      // the actual project and its existing operation sequence untouched.
      const tool={...window.__testChamferTool,id:cam.next_tool_id++,number:99};cam.tools.push(tool);
      const op={kind:'chamfer2d',id:cam.next_operation_id++,name:'Upper-rim test',enabled:true,tool_id:tool.id,
        path:geometry.path,closed:geometry.closed,chain_ref:{source:'model',keys:chain.keys,reversed:false},
        modeled_chamfer:{additional_width:0},top_z:geometry.top_z,chamfer_width:geometry.width,tip_offset:0.5,
        wall_side:geometry.wall_side,direction:'climb',clearance_z:geometry.top_z+10,retract_z:geometry.top_z+5,
        feed_height_z:geometry.top_z+2,cutting:tool.cutting};
      setup.operations=[op];cam.toolpath_generations=[];cam.height_expressions=[];cam.linking=[];
      await engine.setCamDocument(cam);await engine.camRegenerateOperation(op.id);
      const program=await engine.camPlan(setup.id);
      return {name:body.name,edges:chain.keys.length,level:z(seed.points[0]),geometry,holes,commands:program.commands.length};
    },savedModel);
    console.log('Reference job (read-only copy):', JSON.stringify(reference));
    assert.ok(reference.geometry.width>0);assert.ok(reference.geometry.closed);
    assert.ok(reference.commands>0);assert.ok(reference.holes.every(h=>h.edges===1 && h.width>0 && h.wall_side==='outside'));
  }
  assert.deepEqual(errors, []);
  console.log('PASS: exact face loops; upper/lower modeled chamfer; open and reversed edges; viewport preview/click; save/regenerate/reopen.');
} catch (error) {
  console.error(String(error), await page.locator('body').innerText());
  console.error(JSON.stringify(await page.evaluate(() => { const s=window.__appStore.getState().camChainPick; return s && {keys:s.selectedKeys,mode:s.mode,busy:s.busy,error:s.pickError,hover:s.hoverKey,context:s.context}; })));
  if (process.env.CAM_REFERENCE) console.error(JSON.stringify(await page.evaluate(() => ({chain:window.__referenceChain,faces:window.__chainBody.faces.map(f=>({key:f.key,normal:f.plane?.normal,edges:f.edge_keys})),edges:window.__chainBody.edges.map(e=>({key:e.key,a:e.points[0],b:e.points.at(-1)}))}))));
  await page.screenshot({path:'/tmp/nbcad-chamfer-chain-error.png'});
  throw error;
} finally { await browser.close(); }
