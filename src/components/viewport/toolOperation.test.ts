import { ToolOperationGate } from './toolOperation';
const assert = {
  ok(value: unknown, message = 'assertion failed') { if (!value) throw new Error(message); },
  equal(actual: unknown, expected: unknown, message = `${actual} != ${expected}`) { this.ok(actual === expected, message); },
};

const gate = new ToolOperationGate();
const first = {};
const next = {};
const ticket = gate.begin(first, 1)!;
assert.ok(ticket);
assert.equal(gate.begin(first, 1), null, 'Enter/click cannot submit twice');
assert.equal(gate.begin(next, 1), null, 'another tool cannot overtake an in-flight mutation');
assert.equal(gate.settle(ticket, 1, next), 'detached', 'late success must not finish the new run');
assert.equal(gate.pending, false);
const nextTicket = gate.begin(next, 1)!;
assert.equal(gate.settle(ticket, 1, first), 'stale', 'duplicate callback cannot release a newer operation');
assert.equal(gate.pending, true);
assert.equal(gate.settle(nextTicket, 2, next), 'stale', 'old sketch response must not overwrite a reopened sketch');
const retry = gate.begin(next, 2)!;
assert.equal(gate.settle(retry, 2, next), 'current');
assert.ok(gate.begin(next, 2), 'failure/success releases the gate for retry');
console.log('Tool operation cancellation, serialization and retry tests passed.');
