import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.NBCAD_E2E_BASE_URL ?? 'http://localhost:7199');
  await page.getByText('Named Views', { exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0, 'No modal should open at startup');
  const hierarchy = await page.evaluate(async () => {
    const { getEngine } = await import('/src/engine/index.ts');
    const engine = await getEngine();
    await engine.beginSketch({type:'origin_plane',plane:'xy'});
    await engine.addRectangle({mode:'two_point',p1:{x:0,y:0},p2:{x:10,y:10},ctrl_held:true});
    await engine.endSketch();
    const catalog = await engine.profileCatalog();
    const update = await engine.extrude({source_face:null,sketch_name:catalog[0].sketch_name,
      profile_indices:[catalog[0].profiles[0].index],operation:'new_body',extent:{type:'distance',distance:5},
      taper_angle_deg:0,flip:false,target_body_ids:[]});
    window.__appStore.getState().applySolidUpdate(update);
    const group = await engine.createComponent({name:'Presentation group',body_ids:[]});
    const child = await engine.createComponent({name:'Reusable child',body_ids:[update.scene.bodies[0].id],absorb_promoted_bodies:true});
    const parent = await engine.createOccurrence({component_id:group.id,name:'Group'});
    const instance = await engine.createOccurrence({component_id:child.id,name:'Child',parent_occurrence_id:parent.id,
      local_pose:{translation:[20,0,0],rotation:[0,0,0,1]}});
    window.__appStore.setState({assemblyDocument:await engine.assemblyDocument(),assemblySolution:await engine.assemblySolution()});
    return {parent:parent.id,child:instance.id};
  });
  await page.getByText('Named Views', { exact: true }).click({ button: 'right' });
  await page.getByText('Create named view / layout…', { exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Named view and layout' });
  await editor.getByLabel('View name', { exact: true }).fill('Presentation and print');
  await editor.getByText('Use as a print layout', { exact: true }).click();
  await editor.getByLabel('Layout occurrence', { exact:true }).selectOption(String(hierarchy.parent));
  await editor.getByLabel('translation X', { exact:true }).fill('5');
  await editor.getByLabel('translation Y', { exact:true }).fill('6');
  await editor.getByLabel('translation Z', { exact:true }).fill('7');
  await editor.getByLabel('rotation Z', { exact:true }).fill('90');
  const mode = editor.locator('select').last();
  await mode.selectOption('dual');
  assert.equal(await editor.getByLabel('Width (mm)', { exact: true }).inputValue(), '235.5');
  assert.equal(await editor.getByLabel('Height (mm)', { exact: true }).inputValue(), '256');
  await editor.getByRole('button', { name: 'Save and show view' }).click();
  await editor.waitFor({ state: 'hidden' });
  const saved = await page.evaluate(async () => {
    const { getEngine } = await import('/src/engine/index.ts');
    return (await getEngine()).namedViews();
  });
  assert.equal(saved.views[0].name, 'Presentation and print');
  assert.equal(saved.views[0].print_layout, true);
  assert.deepEqual(saved.views[0].print_bed.size_mm, [235.5, 256, 256]);
  assert.deepEqual(saved.views[0].print_bed.origin_mm, [20.5, 0]);
  assert.equal(saved.views[0].print_bed.source.revision.length, 40);
  const resolved = await page.evaluate(async () => {
    const { getEngine } = await import('/src/engine/index.ts');
    return (await getEngine()).namedViewSolution('Presentation and print');
  });
  const movedChild = resolved.occurrence_poses.find(p => p.occurrence_id === hierarchy.child);
  movedChild.translation.forEach((v,i) => assert.ok(Math.abs(v - [5,26,7][i]) < 1e-8));
  await page.evaluate(async () => {
    const { editNamedView } = await import('/src/components/NamedViewDialog.tsx');
    editNamedView('Presentation and print');
  });
  await editor.getByLabel('View name', { exact: true }).waitFor();
  assert.equal(await editor.getByLabel('View name', { exact: true }).inputValue(), 'Presentation and print');
  await page.keyboard.press('Escape');
  await editor.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  console.log('Named-view Browser creation, X2D mode, persistence, editing and cancellation passed');
} finally { await browser.close(); }
