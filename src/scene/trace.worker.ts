import { trace, type TraceJob } from './trace';

/**
 * The tracer, on its own thread.
 *
 * A third of a second of ray tracing is not expensive — it happens once for a
 * room that then costs nothing for the rest of the session — but a third of a
 * second during which nothing on the page can move is a freeze, and on a phone
 * it would be closer to two. So it happens here, where the only thing it can
 * block is itself. The room draws unshaded on the first
 * frame and takes its light a moment later, which nobody has ever noticed
 * happening and everybody notices a locked-up tab.
 *
 * `trace.ts` deliberately imports nothing, so what gets bundled to run in here
 * is the tracer and not a second copy of three.js.
 */
self.onmessage = (event: MessageEvent<{ id: number; job: TraceJob }>) => {
  const { id, job } = event.data;
  const colours = trace(job);
  (self as unknown as Worker).postMessage({ id, colours }, [colours.buffer]);
};
