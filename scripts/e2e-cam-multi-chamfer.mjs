/** Multi-boundary chamfer UI and Rust planning, against actual OCCT geometry. */
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
  const reference = process.env.CAM_REFERENCE
    ? strFromU8(unzipSync(readFileSync(process.env.CAM_REFERENCE))['model.json']) : null;
  await page.evaluate(async reference => {
    const engine = window.__engine, store = window.__appStore.getState();
    const simulate = engine.camSimulate.bind(engine);
    engine.camSimulate = r => simulate({ ...r, voxel_size: 0.5, max_voxels: 40000 });
    let update;
    if (reference) update = await engine.loadProjectModel(reference);
    else {
      store.applySolidUpdate(await engine.newProject());
      await engine.beginSketch({ type: 'origin_plane', plane: 'xy' });
      await engine.addRectangle({ mode: 'two_point', p1: { x: 0, y: 0 }, p2: { x: 40, y: 25 }, ctrl_held: true });
      await engine.endSketch();
      const catalog = await engine.profileCatalog();
      update = await engine.extrude({ source_face: null, sketch_name: catalog[0].sketch_name,
        profile_indices: [catalog[0].profiles[0].index], operation: 'new_body',
        extent: { type: 'distance', distance: 10 }, taper_angle_deg: 0, flip: true, target_body_ids: [] });
      const body = update.scene.bodies[0];
      update = await engine.solidChamfer({ body_id: body.id,
        edge_ids: body.edges.filter(e => e.points.every(p => Math.abs(p.z) < 1e-6)).map(e => e.id), distance: 0.5, tangent_chain: false });
      for (const x of [10, 30]) {
        const b = update.scene.bodies[0];
        const top = b.faces.find(f => f.plane?.normal[2] > 0.99 && Math.abs(f.plane.origin[2]) < 1e-6);
        const v = [x, 12.5, 0].map((n,i) => n-top.plane.origin[i]);
        const dot = a => a.reduce((s,n,i) => s+n*v[i],0);
        update = await engine.hole({ body_id: b.id, face_id: top.id, position: { x: dot(top.plane.u), y: dot(top.plane.v) },
          positions: [], position_reference: null, diameter: 5.5, extent: { type: 'distance', depth: 6 }, style: 'countersink',
          countersink_diameter: 6.5, countersink_angle_deg: 90, counterbore_diameter: 0, counterbore_depth: 0,
          bottom_style: 'drill_point', drill_point_angle_deg: 118, thread: null, flip: false });
      }
    }
    store.applySolidUpdate(update); store.setDocument(update.document);
    store.setFinishedSketches(await engine.finishedSketches()); store.setMode('solid');
    const body = update.scene.bodies[0], cam = await engine.camDocument();
    const tool = cam.tools.find(t => t.kind === 'chamfer_mill' && t.diameter === 6) ?? {
      id: 1, number: 8, name: '90 degree chamfer 6', kind: 'chamfer_mill', diameter: 6, flute_length: 4,
      overall_length: 60, center_cutting: true, flute_count: 4, point_angle_degrees: 90,
      corner_radius: null, cutting: { spindle_rpm: 6000, feed_xy: 1200, feed_z: 600, coolant: 'flood' },
      cutting_presets: [], default_step_down: 1, default_step_over: 1,
    };
    cam.tools = [tool]; cam.next_tool_id = tool.id+1;
    if (!cam.setups.length) cam.setups = [{ id: 1, name: 'Setup A',
      wcs: { origin: { x: 0, y: 0, z: 0 }, x_axis: [1,0,0], y_axis: [0,1,0], z_axis: [0,0,1] },
      wcs_origin: { mode: 'explicit' }, work_offset: 'g54', work_offset_count: 1,
      stock_spec: { mode: 'legacy_box' }, resolved_stock: { shape: 'box' },
      stock: { min: { x: -2, y: -2, z: -12 }, max: { x: 42, y: 27, z: 0.5 } },
      stock_model_box: null, body_ids: [body.id], operations: [] }];
    const setup = cam.setups[0]; setup.operations = []; cam.setups = [setup];
    // No machine settings or actual saved file are changed by this isolated copy.
    setup.machine = null; cam.toolpath_generations = []; cam.height_expressions = []; cam.linking = [];
    cam.active_setup_id = setup.id; cam.next_setup_id = setup.id+1; cam.next_operation_id = 1;
    await store.setCamDocument(cam); store.setSelectedCamSetupId(setup.id);
    store.setSelectedCamOperationId(null); store.setActiveTab('cam');
    const dot = (a,b) => a.reduce((s,n,i)=>s+n*b[i],0);
    const top = body.faces.filter(f => f.plane && dot(f.plane.normal,setup.wcs.z_axis)>0.99)
      .sort((a,b)=>(b.signature?.area??0)-(a.signature?.area??0))[0];
    const upper = body.edges.filter(e => top.edge_keys.includes(e.key));
    window.__rimEdges = upper.filter(e => e.circle?.closed).slice(0,2);
    window.__outerEdge = upper.find(e => !e.circle?.closed);
    window.__rimBody = body; window.__rimSetup = setup;
    if (window.__rimEdges.length !== 2 || !window.__outerEdge) throw Error('Need two modeled rims and an outer boundary.');
  }, reference);
  await page.evaluate(() => { window.__cameraApi.fit(); window.__cameraApi.snapToDirection([0,0,1]); });
  await page.locator('[data-ribbon-button="camChamfer"]').click();
  const dialog = page.getByTestId('cam-operation-dialog');
  await dialog.getByRole('button', { name: 'Geometry', exact: true }).click();
  await page.waitForFunction(() => window.__appStore.getState().camChainPick?.chains);
  await page.waitForFunction(() => { const c=window.__cameraApi.getSnapshot(); return Math.abs(c.position[0]-c.target[0])<1e-7 && Math.abs(c.position[1]-c.target[1])<1e-7; });
  const clicks = await page.evaluate(() => [...window.__rimEdges,window.__outerEdge].map(edge => {
    // Keep both rims outside the floating dialog. This also exercises the
    // shared rim/bevel-seam vertex: automatic picking must prefer the rim.
    const p = edge.circle?.closed ? edge.points.reduce((a,b) => a.x < b.x ? a : b) : {
      x:(edge.points[0].x+edge.points.at(-1).x)/2,
      y:(edge.points[0].y+edge.points.at(-1).y)/2, z:edge.points[0].z,
    };
    return window.__cameraApi.worldToScreen([p.x,p.y,p.z]);
  }));
  // Consecutive real clicks preserve both holes, then the outer boundary.
  for (const p of clicks) await page.mouse.click(p.x,p.y);
  await dialog.getByText('3 chains selected', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Edit chain 3', exact: true }).waitFor();
  await page.waitForFunction(() => window.__appStore.getState().camChainPick.chains.length === 3);
  // Hold the first real Rust resolution, then queue three clicks without
  // awaiting their results. Replies must append in click order, not race.
  await page.evaluate(async () => {
    const {pickCamChain}=await import('/src/cam/chainPicking.ts');
    const s=window.__appStore.getState(),current=s.camChainPick,engine=window.__engine;
    const keys=[...window.__rimEdges,window.__outerEdge].map(e=>`edge:${window.__rimBody.id}:${e.key}`);
    s.setCamChainPick({...current,context:{...current.context},chains:[{keys:[],reversed:false,mode:'closed'}],activeChainIndex:0,selectedKeys:[]});
    const original=engine.geometryEdgeChain.bind(engine);
    engine.geometryEdgeChain=async request => {
      if (request.mode==='closed' && request.keys[0]===keys[0]) {
        engine.geometryEdgeChain=original;
        await new Promise(resolve=>{window.__releaseChain=resolve;});
      }
      return original(request);
    };
    window.__queuedChainPicks=keys.map(key=>pickCamChain(key));
  });
  await page.waitForFunction(()=>window.__releaseChain);
  await page.evaluate(async()=>{window.__releaseChain();await Promise.all(window.__queuedChainPicks);});
  await dialog.getByText('3 chains selected', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.__appStore.getState().camChainPick.chains.slice(0,2).map(c=>c.keys[0])),
    await page.evaluate(()=>window.__rimEdges.map(e=>`edge:${window.__rimBody.id}:${e.key}`)));
  await dialog.getByRole('button', { name: 'Edit chain 1', exact: true }).click();
  await dialog.getByText(/Model width 0.500/).waitFor();
  await dialog.getByRole('button', { name: 'Reverse', exact: true }).click();
  await dialog.getByRole('button', { name: 'Edit chain 1', exact: true }).filter({hasText:'reversed'}).waitFor();
  // A repeated click activates an existing loop without adding a duplicate.
  await page.mouse.click(clicks[1].x,clicks[1].y);
  await dialog.getByText('3 chains selected', { exact: true }).waitFor();
  // A separate manual chain can be built without altering either hole.
  await dialog.getByRole('button', { name: 'Remove chain 3', exact: true }).click();
  await dialog.getByText('2 chains selected', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: '+ New chain', exact: true }).click();
  await dialog.getByRole('button', { name: 'Manual edges', exact: true }).click();
  await page.mouse.click(clicks[2].x,clicks[2].y);
  await dialog.getByText('3 chains selected', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Edit chain 3', exact: true }).filter({hasText:'open'}).waitFor();
  // Completing the loop replaces this manual subset, not another chain.
  await dialog.getByRole('button', { name: 'Closed loop', exact: true }).click();
  await page.mouse.click(clicks[2].x,clicks[2].y);
  await dialog.getByRole('button', { name: 'Edit chain 3', exact: true }).filter({hasText:'closed'}).waitFor();
  // Switching source or receiving an incidental document echo preserves every chain.
  await dialog.getByRole('button', { name: /^Sketch curves/ }).click();
  await dialog.getByRole('button', { name: /^Model edges/ }).click();
  await page.evaluate(async () => { const s=window.__appStore.getState(); await s.setCamDocument(await window.__engine.camDocument()); });
  await dialog.getByText('3 chains selected', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Passes', exact: true }).click();
  await dialog.getByLabel(/^Tip offset/).fill('1');
  await dialog.locator('button[type="submit"]').click();
  await dialog.waitFor({ state: 'detached', timeout: 30000 });
  const result = await page.evaluate(async () => {
    const engine=window.__engine,cam=await engine.camDocument(),op=cam.setups[0].operations[0];
    const program=await engine.camPlan(cam.setups[0].id);
    const exported=await engine.exportProjectModel();
    window.__multiChamferExport=exported;
    const chains=[op,...op.additional_chains];
    return { chains, program, schema:JSON.parse(exported).schema_version };
  });
  assert.equal(result.chains.length,3);
  assert.deepEqual(result.chains.map(c=>c.wall_side),['outside','outside','inside']);
  assert.ok(result.chains.every(c=>Math.abs(c.chamfer_width-0.5)<1e-7));
  assert.equal(result.chains[0].chain_ref.reversed,true);
  assert.equal(result.program.stats.operation_count,1);
  assert.ok(result.program.warnings.some(w=>w.includes('reduced from')));
  assert.ok(result.schema>=4,'older readers must reject instead of silently dropping chains');
  // Manual linking shares real Rust geometry. Default Automatic must survive
  // incidental edits, while explicit dimensions survive save/reopen exactly.
  const openLinking = async () => {
    await page.locator('[data-cam-sort-scope^="operations-"][data-cam-sort-id="1"]').dblclick();
    await dialog.getByRole('button', { name: 'Linking', exact: true }).click();
  };
  const save = async () => {
    await dialog.locator('button[type="submit"]').click();
    await dialog.waitFor({state:'detached',timeout:30000});
  };
  await openLinking();
  assert.equal(await dialog.getByLabel('Lead sizing', {exact:true}).inputValue(),'automatic');
  await dialog.getByLabel('Lead sizing', {exact:true}).selectOption('manual');
  await dialog.getByLabel('Horizontal lead-in radius').fill('0.4');
  await dialog.getByLabel('Lead-in sweep angle').fill('60');
  await dialog.getByLabel('Linear lead-in distance').fill('0.5');
  await dialog.getByLabel('Vertical lead-in radius').fill('0.2');
  await dialog.getByLabel('Same as lead-in', {exact:true}).uncheck();
  await dialog.getByLabel('Horizontal lead-out radius').fill('0.3');
  await dialog.getByLabel('Lead-out sweep angle').fill('120');
  await dialog.getByLabel('Linear lead-out distance').fill('0.25');
  await dialog.getByLabel('Vertical lead-out radius').fill('0.15');
  await dialog.getByLabel('Lead-in feedrate').fill('300');
  await dialog.getByLabel('Lead-out feedrate').fill('450');
  assert.equal(await dialog.getByText('RAMP',{exact:true}).count(),0);
  assert.equal(await dialog.getByLabel('Keep tool down',{exact:true}).count(),0);
  await dialog.getByRole('button', {name:'Tool',exact:true}).click();
  assert.equal(await dialog.getByLabel('Lead-in feedrate').inputValue(),'300');
  await dialog.getByLabel('Lead-in feedrate').fill('310');
  await dialog.getByRole('button', {name:'Linking',exact:true}).click();
  assert.equal(await dialog.getByLabel('Lead-in feedrate').inputValue(),'310');
  await save();
  const manual = await page.evaluate(async () => {
    const engine=window.__engine,cam=await engine.camDocument();
    const program=await engine.camPlan(cam.setups[0].id);
    return {cam,program,exported:await engine.exportProjectModel(),statuses:await engine.camToolpathStatuses()};
  });
  assert.equal(manual.cam.linking.length,1);
  assert.equal(manual.cam.linking[0].lead_in_feed,310);
  assert.equal(manual.cam.linking[0].lead_out.vertical_radius,0.15);
  assert.equal(manual.cam.setups[0].operations[0].additional_chains.length,2);
  assert.ok(manual.statuses.every(s=>s.state==='current'));
  const arcs=manual.program.commands.filter(c=>c.kind==='circular');
  assert.equal(arcs.length,6);
  arcs.forEach((c,i)=>{
    assert.ok(Math.abs(Math.hypot(c.to.x-c.center.x,c.to.y-c.center.y)-(i%2 ? 0.3 : 0.4))<1e-7);
    assert.equal(c.feed,i%2 ? 450 : 310);
  });
  assert.ok(!manual.program.warnings.some(w=>w.includes('reduced from')));
  await openLinking();
  assert.equal(await dialog.getByLabel('Lead sizing',{exact:true}).inputValue(),'manual');
  assert.equal(await dialog.getByLabel('Horizontal lead-in radius').inputValue(),'0.4');
  assert.equal(await dialog.getByLabel('Horizontal lead-out radius').inputValue(),'0.3');
  await dialog.getByLabel('Lead sizing',{exact:true}).selectOption('automatic');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.__engine.camDocument()),manual.cam,'Cancel preserves manual intent');
  // Units are display-only; canceling an inch view must not round saved data.
  await page.evaluate(async () => {const s=window.__appStore.getState(),cam=await window.__engine.camDocument();cam.units='inches';await s.setCamDocument(cam);});
  await openLinking();
  assert.ok(Math.abs(Number(await dialog.getByLabel('Horizontal lead-in radius').inputValue())-0.4/25.4)<1e-8);
  assert.ok(Math.abs(Number(await dialog.getByLabel('Lead-in feedrate').inputValue())-310/25.4)<1e-8);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.evaluate(async model => {
    const engine=window.__engine,s=window.__appStore.getState(),update=await engine.loadProjectModel(model);
    s.applySolidUpdate(update);s.setDocument(update.document);await s.setCamDocument(await engine.camDocument());
  },manual.exported);
  await openLinking();
  assert.equal(await dialog.getByLabel('Lead sizing',{exact:true}).inputValue(),'manual','mode survives archive reload');
  // A rejected oversized manual edit remains repairable; it cannot keep a
  // valid generation stamp or silently revert to the fitting candidate.
  await dialog.getByLabel('Horizontal lead-in radius').fill('100');
  await dialog.locator('button[type="submit"]').click();
  await page.waitForFunction(()=>window.__appStore.getState().constraintDialog?.message.includes('manual lead-in/out'));
  const rejected=await page.evaluate(async () => ({cam:await window.__engine.camDocument(),statuses:await window.__engine.camToolpathStatuses()}));
  assert.equal(rejected.cam.linking[0].lead_in.horizontal_radius,100);
  assert.ok(rejected.statuses.every(s=>s.state!=='current'));
  await page.getByRole('button',{name:'OK',exact:true}).click();
  await dialog.getByLabel('Horizontal lead-in radius').fill('0.4');
  await save();
  // Switching back explicitly removes the manual record and reproduces the
  // original automatic program, rather than preserving hidden manual feeds.
  await openLinking();
  await dialog.getByLabel('Lead sizing',{exact:true}).selectOption('automatic');
  await save();
  const automatic=await page.evaluate(async()=>({cam:await window.__engine.camDocument(),plan:await window.__engine.camPlan(window.__appStore.getState().camDocument.setups[0].id)}));
  assert.equal((automatic.cam.linking??[]).length,0);
  assert.deepEqual(automatic.plan.commands,result.program.commands);
  console.log('PASS: chamfer manual radii/sweeps/vertical rounds/feeds, multi-chain application, metric/inch display, archive reload, cancel, failed-fit repair and return to Automatic.');
  await page.locator('[data-cam-sort-scope^="operations-"][data-cam-sort-id="1"]').dblclick();
  await dialog.getByRole('button', { name: 'Geometry', exact: true }).click();
  await dialog.getByText('3 chains selected', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const reopened=await page.evaluate(async () => {
    const engine=window.__engine;
    await engine.loadProjectModel(window.__multiChamferExport);
    const before=await engine.camDocument(),op=before.setups[0].operations[0];
    await engine.camRegenerateOperation(op.id);
    const after=await engine.camDocument();
    // A broken non-first reference must fail transactionally, not omit a rim.
    const broken=structuredClone(after);
    broken.setups[0].operations[0].additional_chains[0].chain_ref.keys=['edge:1:missing'];
    await engine.setCamDocument(broken);
    let error=''; try { await engine.camRegenerateOperation(op.id); } catch(e) { error=String(e); }
    return {before:op,after:after.setups[0].operations[0],error};
  });
  assert.deepEqual(reopened.before,reopened.after);
  assert.match(reopened.error,/chain 2/i);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({chains:result.chains.length,commands:result.program.commands.length,warnings:result.program.warnings.filter(w=>w.includes('reduced')),source:reference?'read-only reference copy':'OCCT fixture'}));
  console.log('PASS: consecutive multi-chain picking, separate sides, edit/remove/reverse, save/reopen/regenerate, small-hole leads, broken later reference.');
} catch (error) {
  console.error(String(error),await page.locator('body').innerText());
  console.error(await page.evaluate(() => {const s=window.__appStore.getState().camChainPick;return s&&{chains:s.chains,busy:s.busy,error:s.pickError};}));
  await page.screenshot({path:'/tmp/nbcad-multi-chamfer-error.png'});
  throw error;
} finally { await browser.close(); }
