import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '../../mcp-server/client.mjs';

const option = name => process.argv[process.argv.indexOf(name) + 1];
assert(process.argv.includes('--server') && process.argv.includes('--desktop'),
  'Use --server PATH --desktop PATH [--out REPORT]; launches disposable windows only');
const c = new Client(option('--server'));
const report = [];
let ownedWindow = null;
let currentTest;
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function exited(pid, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (alive(pid) && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
  assert(!alive(pid), `Disposable CAD process ${pid} did not exit`);
  if (ownedWindow?.pid === pid) ownedWindow = null;
}
async function launchOwnedWindow() {
  assert.equal(ownedWindow, null, 'Observe the previous disposable window exit before launching another');
  const launch = await c.call('cad_interface', {action:'launch',executable:option('--desktop')});
  assert(Number.isInteger(launch.pid) && launch.pid > 0, 'Launch must identify its disposable process');
  // Record ownership before checking readiness: a starting reply also owns a
  // newly launched process that must be cleaned up if validation stops here.
  ownedWindow = {pid:launch.pid, session_id:launch.session_id};
  assert.equal(launch.status, 'ready', JSON.stringify(launch));
  return launch;
}
async function ui(args) {
  const result = await c.call('cad_interface', args);
  assert.equal(result.status, 'applied', JSON.stringify(result));
  if (ownedWindow && result.active_session_id) ownedWindow.session_id = result.active_session_id;
  return result;
}
async function click(label) {
  const state = await ui({action:'inspect'});
  const matches = state.ui.surfaces.flatMap(s => s.controls).filter(c => c.label === label && !c.disabled);
  assert.equal(matches.length, 1, `Expected one ${label}: ${JSON.stringify(matches)}`);
  return ui({action:'click', target:matches[0].id});
}
async function menuExit() { await click('File'); return click('Exit'); }
async function dirty() {
  await c.call('sketch_begin', {plane:{type:'origin_plane',plane:'xy'}});
  await c.call('sketch_add_rectangle_locked', {mode:'two_point',anchor:{x:0,y:0},corner_hint:{x:20,y:10},width_mm:20,height_mm:10,ctrl_held:true});
  await c.call('sketch_finish');
}

async function cleanupOwnedWindow() {
  const owned = ownedWindow;
  if (!owned) return;
  if (!alive(owned.pid)) { ownedWindow = null; return; }
  const cleanup = {test:currentTest, pid:owned.pid, cleanup:true, forced:false, passed:false};
  report.push(cleanup);
  const previousTimeout = c.timeoutMs;
  c.timeoutMs = 2000;
  try {
    assert(owned.session_id, 'Starting desktop did not publish a session for guarded cleanup');
    await ui({action:'window',mode:'close',session_id:owned.session_id});
    const deadline = Date.now() + 2000;
    let discarded = false;
    while (alive(owned.pid) && Date.now() < deadline) {
      // Only this suite's disposable work may be discarded during cleanup.
      const state = await ui({action:'inspect',session_id:owned.session_id});
      const controls = state.ui.surfaces.flatMap(surface => surface.controls);
      const discard = controls.filter(control => control.label === "Don't Save" && !control.disabled);
      if (!discarded && discard.length === 1) {
        await ui({action:'click',target:discard[0].id,session_id:owned.session_id});
        discarded = true;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  } catch (error) {
    cleanup.error = String(error);
  } finally {
    c.timeoutMs = previousTimeout;
  }
  if (alive(owned.pid)) {
    cleanup.forced = true;
    console.error(`FAIL cleanup: guarded close did not finish; forcibly terminating disposable CAD process ${owned.pid}`);
    // This is failure cleanup, never evidence that the guarded close passed.
    process.kill(owned.pid, 'SIGKILL');
    await exited(owned.pid, 2000);
  } else {
    ownedWindow = null;
  }
}

try {
  await c.start();
  const cases = ['mcp-clean', 'mcp-background', 'menu-clean', 'cancel-discard', 'save-exit'];
  if (process.platform === 'win32') cases.push('native-close');
  for (const test of cases) {
    currentTest = test;
    const launch = await launchOwnedWindow();
    const pid = launch.pid;
    if (test === 'mcp-clean') await ui({action:'window',mode:'close'});
    if (test === 'mcp-background') {
      await ui({action:'window',mode:'background'});
      await ui({action:'window',mode:'close'});
    }
    if (test === 'menu-clean') await menuExit();
    if (test === 'native-close') {
      // Standard WM_CLOSE, the same native request as title-bar X / Alt+F4.
      // Only the PID just launched by this suite may be addressed.
      assert(Number.isInteger(pid) && pid > 0);
      execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',
        `if (!(Get-Process -Id ${pid}).CloseMainWindow()) { exit 1 }`], {windowsHide:true});
    }
    if (test === 'cancel-discard') {
      await dirty();
      const before = await c.call('cad_project_model');
      await ui({action:'window',mode:'close'});
      await click('Cancel');
      assert(alive(pid));
      assert.equal(await c.call('cad_project_model'), before, 'Cancel must preserve work');
      await menuExit();
      await click("Don't Save");
    }
    if (test === 'save-exit') {
      const directory = await mkdtemp(join(tmpdir(), 'nbcad-exit-'));
      const path = join(directory, 'saved.nbcad');
      await ui({action:'file',command:'save',path});
      await dirty();
      const expected = JSON.parse(await c.call('cad_project_model'));
      await ui({action:'window',mode:'close'});
      await click('Save');
      await exited(pid);
      const reopened = await launchOwnedWindow();
      await ui({action:'file',command:'open',path});
      assert.deepEqual(JSON.parse(await c.call('cad_project_model')), expected, 'Save on exit must persist the complete native project');
      await ui({action:'window',mode:'close'});
      await exited(reopened.pid);
    }
    await exited(pid);
    report.push({test,pid,passed:true});
    console.log('PASS', test);
  }
} catch (error) {
  report.push({test:currentTest, pid:ownedWindow?.pid, passed:false, error:String(error)});
  throw error;
} finally {
  try {
    await cleanupOwnedWindow();
  } catch (error) {
    report.push({test:currentTest, pid:ownedWindow?.pid, cleanup:true, passed:false, error:String(error)});
    console.error('FAIL disposable desktop cleanup:', error);
  } finally {
    c.close();
    if (process.argv.includes('--out')) await writeFile(option('--out'), JSON.stringify(report,null,2));
  }
}
