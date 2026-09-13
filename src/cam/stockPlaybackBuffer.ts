import type { Engine } from '../engine';
import type { CamBufferedFrameDto, CamSimulationRequestDto, CamSimulationResultDto } from '../engine/types';

const MAX_READY_FRAMES = 8;
const MAX_READY_BYTES = 24 * 1024 * 1024;
const EPS = 1e-7;
type Clock = { time_seconds: number; speed: number; playing: boolean };
type Frame = CamBufferedFrameDto & { time: number };

/** One bounded look-ahead producer and a separate cheap display consumer.
 * The native engine retains meshes; JS queues metadata/handles, not geometry.
 * No future stock is displayed ahead of the physical cutter clock. */
export class StockPlaybackBuffer {
  readyUntil: number;
  private frames: Frame[] = [];
  private session: number | null = null;
  private closed = false;
  private inFlight = false;
  private presenting = false;
  private epoch = 0;
  private lastPresented = -1;
  private desiredTime: number;
  private observedTime: number;
  private costSeconds = 0.10;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ready = false;

  constructor(private engine: Engine, private request: CamSimulationRequestDto,
    private startTime: number, private endTime: number,
    private clock: () => Clock | null,
    private publish: (result: CamSimulationResultDto) => void,
    private status: (buffering: boolean) => void,
    private error: (error: unknown) => void) {
    this.readyUntil = this.desiredTime = this.observedTime = startTime;
  }

  async start() {
    try {
      if (this.engine.camPlaybackOpen) {
        this.session = await this.engine.camPlaybackOpen(this.request, this.startTime);
        if (this.closed) { await this.engine.camPlaybackClose?.(this.session); return; }
      }
      if (this.closed) return;
      this.ready = true;
      this.tick();
      this.timer = setInterval(() => this.tick(), 40);
    } catch (error) { this.fail(error); }
  }

  close() {
    this.closed = true;
    this.epoch++;
    this.frames = [];
    if (this.timer) clearInterval(this.timer);
    if (this.session !== null) void this.engine.camPlaybackClose?.(this.session).catch(() => undefined);
  }

  private fail(error: unknown) {
    if (this.closed) return;
    this.error(error);
    this.status(false);
    this.close();
  }

  private tick() {
    if (this.closed || !this.ready) return;
    const clock = this.clock();
    if (!clock) return;
    const time = clock.time_seconds;
    // A seek always pauses the user clock. Do not mistake a normal forward
    // clock tick for a new demand or discard prepared look-ahead frames.
    if ((!clock.playing && Math.abs(time - this.observedTime) > EPS) || time < this.observedTime - EPS) {
      this.epoch++;
      this.frames = [];
      this.desiredTime = time;
      this.readyUntil = time;
      this.lastPresented = -1;
    }
    this.observedTime = time;
    let due = this.frames.length - 1;
    while (due >= 0 && this.frames[due].time > time + EPS) due--;
    if (due >= 0 && this.frames[due].frame_id !== this.lastPresented && !this.presenting) {
      const frame = this.frames[due];
      const epoch = this.epoch;
      this.presenting = true;
      const present = this.session !== null && this.engine.camPlaybackPresent
        ? this.engine.camPlaybackPresent(this.session, frame.frame_id) : Promise.resolve();
      void present.then(() => {
        if (this.closed || epoch !== this.epoch) return;
        this.publish(frame.simulation);
        this.lastPresented = frame.frame_id;
        // Keep just the displayed state and the future states. Native retention
        // applies its own larger hard cap even if this client disappears.
        this.frames = this.frames.filter((candidate) => candidate.time >= frame.time);
      }).catch((error) => { if (epoch === this.epoch) this.fail(error); }).finally(() => { this.presenting = false; });
    }
    const caughtUp = this.lastPresented >= 0 && (!clock.playing || this.readyUntil > time + EPS || time >= this.endTime - EPS);
    this.status(!caughtUp);
    if (this.inFlight || this.frames.length >= MAX_READY_FRAMES
      || this.frames.reduce((sum, frame) => sum + frame.mesh_bytes, 0) >= MAX_READY_BYTES) return;
    const last = this.frames[this.frames.length - 1];
    if (last && last.time >= this.endTime - EPS) return;
    // A conservative moving estimate makes stock cadence adapt to measured
    // preparation cost, not force an overloaded machine into an 8-Hz workload.
    // Cutter interpolation and orbit stay on their independent frame clock.
    const stride = Math.max(0.125, Math.min(1.0, this.costSeconds * 1.8)) * Math.max(0.25, clock.speed);
    const sampleTime = last ? Math.min(this.endTime, last.time + stride) : this.desiredTime;
    const epoch = this.epoch;
    this.inFlight = true;
    const started = performance.now();
    const sample = this.session !== null && this.engine.camPlaybackSample
      ? this.engine.camPlaybackSample(this.session, sampleTime)
      : this.engine.camSimulate({ ...this.request, playback_time_seconds: sampleTime }).then((simulation) => ({
          frame_id: started, compute_ms: performance.now() - started,
          mesh_bytes: ((simulation.stock_mesh?.positions.length ?? 0) + (simulation.stock_mesh?.normals?.length ?? 0)) * 4,
          simulation,
        }));
    void sample.then((frame) => {
      if (this.closed || epoch !== this.epoch) return;
      this.frames.push({ ...frame, time: sampleTime });
      while (this.frames.length > 1 && this.frames.reduce((sum, ready) => sum + ready.mesh_bytes, 0) > MAX_READY_BYTES) {
        // Retain the displayed/first state and the newest look-ahead. If a
        // later surface grows unexpectedly, thin snapshot cadence, not geometry.
        this.frames.splice(this.frames.length > 2 ? 1 : 0, 1);
      }
      this.readyUntil = sampleTime;
      this.costSeconds = Math.max(frame.compute_ms / 1000, this.costSeconds * 0.92);
    }).catch((error) => { if (epoch === this.epoch) this.fail(error); }).finally(() => {
      this.inFlight = false;
      if (!this.closed) this.tick();
    });
  }
}
