import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
const args=process.argv.slice(2);
const option=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
const binary=option('--server');
assert(binary,'Use --server /path/to/nbcad-mcp --session UUID [--model model.json] [--out report.json]');
export class Client {
  constructor() {
    this.next = 0;
    this.pending = new Map();
    this.child = spawn(binary, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.errors = '';
    this.child.stderr.on('data', chunk => { this.errors = (this.errors + chunk).slice(-4000); });
    this.child.stdin.on('error', error => this.fail(error));
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', code => this.fail(new Error(`MCP exited (${code}): ${this.errors}`)));
    createInterface({ input: this.child.stdout }).on('line', line => {
      let reply;
      try { reply = JSON.parse(line); } catch { return this.fail(new Error(`Non-JSON MCP stdout: ${line.slice(0, 200)}`)); }
      const pending = this.pending.get(reply.id);
      if (!pending) return; // notifications, including focus changes
      this.pending.delete(reply.id);
      clearTimeout(pending.timer);
      if (reply.error) pending.reject(new Error(JSON.stringify(reply.error)));
      else pending.resolve(reply.result);
    });
  }
  fail(error) {
    this.failure = error;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
  rpc(method, params) {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  async start() {
    await this.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'part-design-goldens', version: '1' } });
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  }
  async call(name, args = {}) {
    const result = await this.rpc('tools/call', { name, arguments: args });
    assert(!result.isError, `${name}: ${JSON.stringify(result.content)}`);
    const value = JSON.parse(result.content.find(item => item.type === 'text').text);
    if (value?.scene?.errors) assert.equal(value.scene.errors.length, 0, `${name}: ${JSON.stringify(value.scene.errors)}`);
    return value;
  }
  close() { this.child.stdin.end(); this.child.kill(); }
}


const c=new Client();
const report={views:[],operations:[]};
try {
 await c.start();
 const id=option('--session');
 assert(id,'Use --session UUID for an active disposable test document');
 await c.call('cad_attach',{session_id:id});
 const generation=async()=> (await c.call('cad_list_sessions')).session_details.find(s=>s.session_id===id).heartbeat.generation;
 const mutate=async(name,args)=>{
  const submitted=await c.call('cad_submit',{name,arguments:args,base_generation:await generation()});
  const applied=await c.call('cad_await_apply',{seq:submitted.seq,timeout_ms:10000});
  assert.equal(applied.status,'applied',JSON.stringify(applied));
  await c.call('cad_refresh');
  report.operations.push({name,status:applied.status});
 };
 if (option('--model')) await mutate('cad_load_project_model',{model_json:await readFile(option('--model'),'utf8')});
 const original=await c.call('cad_project_model');
 const beforeGeneration=await generation();
 const directions={top:[0,0,1],bottom:[0,0,-1],front:[0,-1,0],back:[0,1,0],left:[-1,0,0],right:[1,0,0]};
 for (const view of ['current',...Object.keys(directions),'isometric']) {
  const result=await c.call('cad_view',{view,fit:view!=='current'});
  assert.equal(result.status,'applied',JSON.stringify(result));
  assert(result.camera.position.every(Number.isFinite));
  if(directions[view]) {
   const offset=result.camera.position.map((n,i)=>n-result.camera.target[i]);
   const length=Math.hypot(...offset);
   directions[view].forEach((n,i)=>assert(Math.abs(offset[i]/length-n)<1e-5,JSON.stringify(result)));
  }
  assert.equal(await generation(),beforeGeneration,'Camera changed engine generation');
  report.views.push({view,...result});
  console.log('PASS view',view);
 }
 await c.call('cad_refresh');
 assert.deepEqual(JSON.parse(await c.call('cad_project_model')),JSON.parse(original),'Camera changed model');
 const base=JSON.parse(original), joint=base.assembly.joints[0];
 assert(joint,'Test document needs a joint');
 try {
  await mutate('assembly_set_joint_enabled',{joint_id:joint.id,enabled:false});
  let model=JSON.parse(await c.call('cad_project_model'));
  assert.deepEqual(model.assembly.joints[0],{...joint,enabled:false});
  await mutate('assembly_set_joint_enabled',{joint_id:joint.id,enabled:true});
  const movable={...joint,kind:'revolute',enabled:true,limits:null,angle_limits:null,linear_limits:null};
  await mutate('assembly_update_joint',{joint:movable});
  await mutate('assembly_set_joint_motion',{joint_id:joint.id,angle_offset_deg:15,linear_offset_mm:0});
  model=JSON.parse(await c.call('cad_project_model'));
  assert.deepEqual(model.assembly.joints[0],{...movable,angle_offset_deg:15,linear_offset_mm:0});
  await mutate('assembly_delete_joint',{joint_id:joint.id});
  model=JSON.parse(await c.call('cad_project_model'));
  assert(!model.assembly.joints.some(j=>j.id===joint.id));
 } finally {
  await mutate('cad_load_project_model',{model_json:original});
 }
 const solution=await c.call('assembly_solution');
 assert.equal(solution.solved,true);
 assert.equal(solution.diagnostics.length,0);
 if (option('--out')) await writeFile(option('--out'),JSON.stringify(report,null,2));
 console.log('PASS live camera and joint controls; original assembly restored');
} finally {c.close();}

