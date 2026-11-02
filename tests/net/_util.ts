import { MockRobotServer, type MockRobotOptions } from '../../src/tools/mock-robot';
import { RobotConnection, type ConnectionEvent, type RobotConnectionOptions } from '../../src/net/connection';

/** Poll until `fn` returns a truthy value (returned) or time runs out (throws with `what`). */
export async function waitFor<T>(fn: () => T | undefined | null | false, what = 'condition', timeoutMs = 4000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Collects resources and tears them down (reverse order) in `afterEach`. */
export class Cleanup {
  private readonly fns: Array<() => Promise<void> | void> = [];

  add<T>(value: T, dispose: (v: T) => Promise<void> | void): T {
    this.fns.push(() => dispose(value));
    return value;
  }

  async mock(options: MockRobotOptions = {}): Promise<MockRobotServer> {
    const m = new MockRobotServer({ poseHz: 30, ...options });
    await m.start();
    return this.add(m, (s) => s.stop());
  }

  connection(options: RobotConnectionOptions): RobotConnection {
    const c = new RobotConnection(options);
    return this.add(c, (x) => x.close());
  }

  async run(): Promise<void> {
    const fns = this.fns.splice(0).reverse();
    for (const fn of fns) {
      try {
        await fn();
      } catch {
        // best effort
      }
    }
  }
}

/** Record every ConnectionEvent of `conn`. */
export function recordEvents(conn: RobotConnection): ConnectionEvent[] {
  const events: ConnectionEvent[] = [];
  conn.subscribe((e) => events.push(e));
  return events;
}

/** A minimal valid robot route (frames) for PUTs that pass the client-side contract check. */
export const ROUTE_A = '[{"x":1,"y":2}]';
export const ROUTE_B = '[{"x":3,"y":0}]';
