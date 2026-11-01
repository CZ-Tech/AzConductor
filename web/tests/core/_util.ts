import { makeNode, type ControlNode } from '../../src/core/node';

/** mulberry32 种子随机数，返回 [0,1)。 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const between = (r: () => number, lo: number, hi: number): number => lo + (hi - lo) * r();

export function randomNode(r: () => number): ControlNode {
  const n = makeNode({
    x: between(r, -72, 72),
    y: between(r, -72, 72),
    dx: between(r, -100, 100),
    dy: between(r, -100, 100),
    heading: between(r, -360, 360),
    dHeading: between(r, -90, 90),
    duration: r() < 0.1 ? 0 : between(r, 0.1, 5),
    marker: r() < 0.3 ? `m${Math.floor(r() * 100)}` : '',
    command: r() < 0.3 ? `cmd\u4e2d\u6587${Math.floor(r() * 100)}` : '',
    commandParams: r() < 0.3 ? ['a', '"q"', '\u00e9'] : [],
    delayAfterArrive: r() < 0.4 ? between(r, 0.01, 4) : 0,
    maxPower: between(r, 0, 1),
    brakeZoneIn: r() < 0.3 ? between(r, 1, 20) : 0,
  });
  if (r() < 0.4) n.maxSpeed = between(r, 1, 60);
  if (r() < 0.3) n.endSpeed = r() < 0.3 ? 0 : between(r, 0, 30);
  if (r() < 0.3) n.brakeForwardPower = between(r, 0, 1);
  return n;
}

export function randomRoute(r: () => number, count: number): ControlNode[] {
  return Array.from({ length: count }, () => randomNode(r));
}

export const pt = (x = 0): ControlNode => makeNode({ x, y: 0, dx: 20, dy: 0 });
