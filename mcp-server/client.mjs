import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
export class Client {
  constructor(binary, timeoutMs = 60000) {
    this.timeoutMs = timeoutMs;
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
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, this.timeoutMs);
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
  close() {
    this.fail(new Error('MCP client closed'));
    this.child.stdin.destroy(); this.child.stdout.destroy(); this.child.stderr.destroy();
    this.child.kill(); this.child.unref();
  }
}


