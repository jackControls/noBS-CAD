import assert from 'node:assert/strict';
import { StockPlaybackBuffer } from '../src/cam/stockPlaybackBuffer';
import type { Engine } from '../src/engine';
import type { CamSimulationResultDto } from '../src/engine/types';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const request = { setup_id: 1 };
async function fixture(bytes: number) {
  const clock = { time_seconds: 0, speed: 1, playing: false };
  const samples: number[] = [], shown: number[] = [], closed: number[] = [];
  let presentedId = 0;
  const engine = {
    camPlaybackOpen: async () => 11,
    camPlaybackSample: async (_session: number, time: number) => {
      samples.push(time);
      return { frame_id: samples.length, compute_ms: 100, mesh_bytes: bytes,
        simulation: { estimated_seconds: time } as CamSimulationResultDto };
    },
    camPlaybackPresent: async (_session: number, id: number) => { presentedId = id; },
    camPlaybackClose: async (id: number) => { closed.push(id); },
  } as unknown as Engine;
  const buffer = new StockPlaybackBuffer(engine, request, 0, 30, () => clock,
    (result) => { assert.ok(presentedId > 0); shown.push(result.estimated_seconds); }, () => {}, (error) => { throw error; });
  await buffer.start();
  await delay(10);
  return { clock, samples, shown, closed, buffer };
}

const small = await fixture(1024);
assert.equal(small.samples.length, 8, 'look-ahead must stop at eight ready frames');
assert.deepEqual(small.shown, [0], 'prefetch must not display future removal');
assert.ok(small.buffer.readyUntil > 0.5);
small.clock.time_seconds = 1;
await delay(70);
assert.equal(small.shown[small.shown.length - 1], 1, 'a paused seek gets an exact prepared sample');
small.buffer.close();
const stoppedCount = small.samples.length;
await delay(60);
assert.equal(small.samples.length, stoppedCount);
assert.deepEqual(small.closed, [11]);

const large = await fixture(8 * 1024 * 1024);
assert.equal(large.samples.length, 3, 'look-ahead must also stop at the byte budget');
large.buffer.close();

let resolveOpen: (id: number) => void = () => {};
const lateCloses: number[] = [];
const lateEngine = { camPlaybackOpen: () => new Promise<number>((resolve) => { resolveOpen = resolve; }),
  camPlaybackClose: async (id: number) => { lateCloses.push(id); } } as unknown as Engine;
const late = new StockPlaybackBuffer(lateEngine, request, 0, 1, () => null,
  () => assert.fail('closed buffer published'), () => {}, () => assert.fail('closed buffer errored'));
const opening = late.start();
late.close();
resolveOpen(12);
await opening;
assert.deepEqual(lateCloses, [12], 'close during preparation must release a late native session');
// One Play action must survive repeated underruns and reach the final stock
// without stopping the user clock or requiring repeated Play clicks.
const clock = { time_seconds: 0, speed: 8, playing: true };
const shown: number[] = [];
const failures: unknown[] = [];
let frameId = 0;
const slowEngine = {
  camPlaybackOpen: async () => 13,
  camPlaybackSample: async (_session: number, time: number) => {
    await delay(55);
    return { frame_id: ++frameId, compute_ms: 55, mesh_bytes: 4096,
      simulation: { estimated_seconds: time } as CamSimulationResultDto };
  },
  camPlaybackPresent: async () => {}, camPlaybackClose: async () => {},
} as unknown as Engine;
const continuous = new StockPlaybackBuffer(slowEngine, request, 0, 4, () => clock,
  (frame) => { assert.ok(frame.estimated_seconds <= clock.time_seconds + 1e-8); shown.push(frame.estimated_seconds); },
  () => {}, (error) => failures.push(error));
await continuous.start();
for (let tick = 0; tick < 200 && shown.at(-1) !== 4; tick++) {
  clock.time_seconds = Math.min(4, continuous.readyUntil, clock.time_seconds + 0.16);
  await delay(20);
}
assert.equal(clock.playing, true, 'underrun must not pause playback');
assert.equal(shown.at(-1), 4, 'single play reaches the final prepared stock');
assert.deepEqual(failures, []);
continuous.close();
console.log('PASS: bounded look-ahead, no future stock, exact seek, cancellation and complete single-Play playback');
