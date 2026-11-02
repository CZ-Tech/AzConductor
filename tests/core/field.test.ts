import { describe, expect, it } from 'vitest';
import {
  FIELD_BOUNDS,
  FIELD_HALF,
  FIELD_SIZE,
  FIELD_VIEWBOX,
  FIELD_X_ANGLE_DEG,
  K_VELOCITY_HANDLE,
  NEW_POINT_DX,
  NEW_POINT_STEP,
  ROBOT_WIDTH,
  appendedNode,
  clampToField,
  firstNode,
  headDotOffsetScreen,
  headingFromPointer,
  headingFromScreenAngle,
  logicalToScreen,
  mirrorLogical,
  mirrorNodes,
  mirrorScreen,
  nodeAtLogical,
  robotScreenRotation,
  screenDeltaToLogicalDelta,
  screenToLogical,
  velocityFromHandleLogical,
  velocityFromHandleScreen,
  velocityHandleLogical,
  velocityHandleScreen,
  wrapHeading,
} from '../../src/core/field';
import { makeNode } from '../../src/core/node';
import { between, randomRoute, rng } from './_util';

const DEG = 180 / Math.PI;
/** 两个角度（度）在模 360 意义下相等。 */
function expectAngleEqual(a: number, b: number, digits = 8): void {
  const d = (((a - b) % 360) + 540) % 360 - 180;
  expect(Math.abs(d)).toBeLessThan(10 ** -digits);
}

describe('常量', () => {
  it('场地 144×144，原点居中，viewBox', () => {
    expect(FIELD_SIZE).toBe(144);
    expect(FIELD_HALF).toBe(72);
    expect(FIELD_VIEWBOX).toBe('-72 -72 144 144');
    expect(FIELD_BOUNDS).toEqual({ minX: -72, maxX: 72, minY: -72, maxY: 72 });
    expect(K_VELOCITY_HANDLE).toBe(5);
    expect(NEW_POINT_DX).toBe(50);
    expect(NEW_POINT_STEP).toBe(10);
    expect(FIELD_X_ANGLE_DEG).toBe(90);
  });
});

describe('坐标变换', () => {
  it('logicalToScreen：sx=y, sy=x', () => {
    expect(logicalToScreen(10, 20)).toEqual({ sx: 20, sy: 10 });
    expect(screenToLogical(20, 10)).toEqual({ x: 10, y: 20 });
  });

  it('属性：screen↔logical 互为逆', () => {
    const r = rng(1);
    for (let i = 0; i < 200; i++) {
      const x = between(r, -100, 100);
      const y = between(r, -100, 100);
      const s = logicalToScreen(x, y);
      expect(screenToLogical(s.sx, s.sy)).toEqual({ x, y });
      const l = screenToLogical(x, y);
      expect(logicalToScreen(l.x, l.y)).toEqual({ sx: x, sy: y });
    }
  });

  it('screenDeltaToLogicalDelta：dx=dsy, dy=dsx（与位置变换一致）', () => {
    expect(screenDeltaToLogicalDelta(3, 4)).toEqual({ x: 4, y: 3 });
    const r = rng(2);
    for (let i = 0; i < 50; i++) {
      const a = { sx: between(r, -50, 50), sy: between(r, -50, 50) };
      const b = { sx: between(r, -50, 50), sy: between(r, -50, 50) };
      const la = screenToLogical(a.sx, a.sy);
      const lb = screenToLogical(b.sx, b.sy);
      const d = screenDeltaToLogicalDelta(b.sx - a.sx, b.sy - a.sy);
      expect(d.x).toBeCloseTo(lb.x - la.x, 12);
      expect(d.y).toBeCloseTo(lb.y - la.y, 12);
    }
  });
});

describe('clampToField', () => {
  it('场内不变，场外夹到 ±72（各轴独立）', () => {
    expect(clampToField(10, -20)).toEqual({ x: 10, y: -20 });
    expect(clampToField(72, -72)).toEqual({ x: 72, y: -72 });
    expect(clampToField(100, 0)).toEqual({ x: 72, y: 0 });
    expect(clampToField(-100, 200)).toEqual({ x: -72, y: 72 });
    expect(clampToField(0, -73)).toEqual({ x: 0, y: -72 });
  });
  it('属性：结果始终在场内且幂等', () => {
    const r = rng(3);
    for (let i = 0; i < 200; i++) {
      const c = clampToField(between(r, -500, 500), between(r, -500, 500));
      expect(Math.abs(c.x)).toBeLessThanOrEqual(72);
      expect(Math.abs(c.y)).toBeLessThanOrEqual(72);
      expect(clampToField(c.x, c.y)).toEqual(c);
    }
  });
});

describe('机器人朝向', () => {
  it('robotScreenRotation = 90 - heading', () => {
    expect(robotScreenRotation(0)).toBe(90);
    expect(robotScreenRotation(90)).toBe(0);
    expect(robotScreenRotation(-90)).toBe(180);
    expect(robotScreenRotation(180)).toBe(-90);
    const r = rng(4);
    for (let i = 0; i < 50; i++) {
      const h = between(r, -720, 720);
      expect(robotScreenRotation(h)).toBe(90 - h);
    }
  });

  it('wrapHeading 规格化到 (-180, 180]', () => {
    expect(wrapHeading(0)).toBe(0);
    expect(wrapHeading(180)).toBe(180);
    expect(wrapHeading(-180)).toBe(180);
    expect(wrapHeading(181)).toBe(-179);
    expect(wrapHeading(-181)).toBe(179);
    expect(wrapHeading(540)).toBe(180);
    expect(wrapHeading(-540)).toBe(180);
    expect(wrapHeading(360)).toBe(0);
    expect(wrapHeading(725)).toBe(5);
    const r = rng(5);
    for (let i = 0; i < 200; i++) {
      const w = wrapHeading(between(r, -1000, 1000));
      expect(w).toBeGreaterThan(-180);
      expect(w).toBeLessThanOrEqual(180);
    }
  });

  it('headingFromScreenAngle = wrap(90 - 屏幕角)', () => {
    expect(headingFromScreenAngle(90)).toBe(0);
    expect(headingFromScreenAngle(0)).toBe(90);
    expect(headingFromScreenAngle(-90)).toBe(180);
    expect(headingFromScreenAngle(180)).toBe(-90);
    expect(headingFromScreenAngle(270)).toBe(180);
  });

  it('属性：headingFromScreenAngle(robotScreenRotation(h)) ≡ h (mod 360)，且在 (-180,180]', () => {
    const r = rng(6);
    for (let i = 0; i < 200; i++) {
      const h = between(r, -720, 720);
      const back = headingFromScreenAngle(robotScreenRotation(h));
      expectAngleEqual(back, h, 9);
      expect(back).toBeGreaterThan(-180);
      expect(back).toBeLessThanOrEqual(180);
      expect(back).toBeCloseTo(wrapHeading(h), 9);
    }
  });

  it('headingFromPointer：下=0°（逻辑 +x），右=90°（逻辑 +y），上=180°，左=-90°', () => {
    expect(headingFromPointer(0, 0, 0, 10)).toBeCloseTo(0, 9);
    expect(headingFromPointer(0, 0, 10, 0)).toBeCloseTo(90, 9);
    expect(headingFromPointer(0, 0, 0, -10)).toBeCloseTo(180, 9);
    expect(headingFromPointer(0, 0, -10, 0)).toBeCloseTo(-90, 9);
    expect(headingFromPointer(0, 0, 10, 10)).toBeCloseTo(45, 9);
    // 与旋转中心的位置无关
    expect(headingFromPointer(30, -20, 30, -10)).toBeCloseTo(0, 9);
  });

  it('属性：headingFromPointer 等于逻辑方向的 atan2(dy, dx)', () => {
    const r = rng(7);
    for (let i = 0; i < 200; i++) {
      const cx = between(r, -72, 72);
      const cy = between(r, -72, 72);
      const px = between(r, -72, 72);
      const py = between(r, -72, 72);
      const h = headingFromPointer(cx, cy, px, py);
      const c = screenToLogical(cx, cy);
      const p = screenToLogical(px, py);
      expectAngleEqual(h, Math.atan2(p.y - c.y, p.x - c.x) * DEG, 8);
    }
  });

  it('属性：车头圆点位于指针方向（拖拽旋转的往返）', () => {
    const r = rng(8);
    for (let i = 0; i < 100; i++) {
      const h = between(r, -180, 180);
      const dot = headDotOffsetScreen(h);
      expect(Math.hypot(dot.sx, dot.sy)).toBeCloseTo(ROBOT_WIDTH / 2, 9);
      expectAngleEqual(headingFromPointer(0, 0, dot.sx, dot.sy), h, 7);
    }
  });

  it('headDotOffsetScreen：heading 0 指向屏幕下，90 指向屏幕右', () => {
    const d0 = headDotOffsetScreen(0);
    expect(d0.sx).toBeCloseTo(0, 9);
    expect(d0.sy).toBeCloseTo(9, 9);
    const d90 = headDotOffsetScreen(90);
    expect(d90.sx).toBeCloseTo(9, 9);
    expect(d90.sy).toBeCloseTo(0, 9);
  });
});

describe('速度手柄', () => {
  const n = { x: 10, y: -5, dx: 50, dy: -25 };

  it('手柄逻辑位置 = 节点 + (dx,dy)/5', () => {
    expect(velocityHandleLogical(n)).toEqual({ x: 20, y: -10 });
  });

  it('手柄屏幕位置 = 逻辑位置转屏幕', () => {
    expect(velocityHandleScreen(n)).toEqual({ sx: -10, sy: 20 });
  });

  it('velocityFromHandleLogical 反解', () => {
    expect(velocityFromHandleLogical(n, 20, -10)).toEqual({ dx: 50, dy: -25 });
  });

  it('属性：handle ↔ velocity 互为逆（逻辑 / 屏幕）', () => {
    const r = rng(9);
    for (let i = 0; i < 200; i++) {
      const node = {
        x: between(r, -72, 72),
        y: between(r, -72, 72),
        dx: between(r, -150, 150),
        dy: between(r, -150, 150),
      };
      const hl = velocityHandleLogical(node);
      const v1 = velocityFromHandleLogical(node, hl.x, hl.y);
      expect(v1.dx).toBeCloseTo(node.dx, 9);
      expect(v1.dy).toBeCloseTo(node.dy, 9);
      const hs = velocityHandleScreen(node);
      const v2 = velocityFromHandleScreen(node, hs.sx, hs.sy);
      expect(v2.dx).toBeCloseTo(node.dx, 9);
      expect(v2.dy).toBeCloseTo(node.dy, 9);
      // 反向：任意手柄位置 → 速度 → 手柄位置
      const hx = between(r, -72, 72);
      const hy = between(r, -72, 72);
      const v = velocityFromHandleLogical(node, hx, hy);
      const back = velocityHandleLogical({ ...node, ...v });
      expect(back.x).toBeCloseTo(hx, 9);
      expect(back.y).toBeCloseTo(hy, 9);
    }
  });
});

describe('新点', () => {
  it('firstNode：(0,0)，dx=50，dy=0，其余默认', () => {
    expect(firstNode()).toEqual(makeNode({ x: 0, y: 0, dx: 50, dy: 0 }));
    expect(firstNode().duration).toBe(1);
    expect(firstNode().maxPower).toBe(1);
  });

  it('nodeAtLogical：dx=50，dy=0，位置夹到场内', () => {
    expect(nodeAtLogical(10, 20)).toEqual(makeNode({ x: 10, y: 20, dx: 50, dy: 0 }));
    expect(nodeAtLogical(100, -100)).toMatchObject({ x: 72, y: -72, dx: 50, dy: 0 });
  });

  it('appendedNode(undefined) = firstNode', () => {
    expect(appendedNode(undefined)).toEqual(firstNode());
  });

  it('appendedNode：沿 x 前进 10，y 不变', () => {
    const last = makeNode({ x: 0, y: 5, dx: 30, dy: 7, heading: 45, duration: 3 });
    const n = appendedNode(last);
    expect(n.x).toBe(10);
    expect(n.y).toBe(5);
  });

  it('appendedNode：到达 x 边界时改沿 y 前进 10', () => {
    expect(appendedNode(makeNode({ x: 72, y: 5 }))).toMatchObject({ x: 72, y: 15 });
    expect(appendedNode(makeNode({ x: 65, y: 5 }))).toMatchObject({ x: 72, y: 5 });
  });

  it('appendedNode：x、y 都到边界时原地不动', () => {
    expect(appendedNode(makeNode({ x: 72, y: 72 }))).toMatchObject({ x: 72, y: 72 });
    expect(appendedNode(makeNode({ x: 72, y: 68 }))).toMatchObject({ x: 72, y: 72 });
  });

  it('appendedNode：继承几何与巡航功率，不继承动作 / 延迟 / 末端制动', () => {
    const last = makeNode({
      x: 0, y: 0, dx: 30, dy: 7, heading: 45, dHeading: 3, duration: 3,
      marker: 'A', command: 'shoot', commandParams: ['1'], delayAfterArrive: 2,
      endSpeed: 0, brakeZoneIn: 10, brakeForwardPower: 0.2, maxPower: 0.5, maxSpeed: 24,
    });
    const n = appendedNode(last);
    expect(n).toMatchObject({ dx: 30, dy: 7, heading: 45, dHeading: 3, duration: 3, maxPower: 0.5, maxSpeed: 24 });
    expect(n.marker).toBe('');
    expect(n.command).toBe('');
    expect(n.commandParams).toEqual([]);
    expect(n.delayAfterArrive).toBe(0);
    expect(n.brakeZoneIn).toBe(0);
    expect('endSpeed' in n).toBe(false);
    expect('brakeForwardPower' in n).toBe(false);
    // 不修改原节点
    expect(last.marker).toBe('A');
    expect(last.endSpeed).toBe(0);
  });

  it('属性：追加的点始终在场内（上一点在场内时）', () => {
    const r = rng(10);
    for (let i = 0; i < 200; i++) {
      const last = makeNode({ x: between(r, -72, 72), y: between(r, -72, 72) });
      const n = appendedNode(last);
      expect(n.x).toBeGreaterThanOrEqual(-72);
      expect(n.x).toBeLessThanOrEqual(72);
      expect(n.y).toBeGreaterThanOrEqual(-72);
      expect(n.y).toBeLessThanOrEqual(72);
    }
  });
});

describe('镜像', () => {
  it('mirrorLogical：y 取反；mirrorScreen：sx 取反', () => {
    expect(mirrorLogical(3, 4)).toEqual({ x: 3, y: -4 });
    expect(mirrorScreen(3, 4)).toEqual({ sx: -3, sy: 4 });
  });

  it('逻辑镜像与屏幕镜像一致', () => {
    const r = rng(11);
    for (let i = 0; i < 50; i++) {
      const x = between(r, -72, 72);
      const y = between(r, -72, 72);
      const m = mirrorLogical(x, y);
      const s = logicalToScreen(x, y);
      expect(logicalToScreen(m.x, m.y)).toEqual(mirrorScreen(s.sx, s.sy));
    }
  });

  it('mirrorNodes：y/dy/heading/dHeading 取反，其余不变', () => {
    const n = makeNode({
      x: 1, y: 2, dx: 3, dy: 4, heading: 30, dHeading: 5, duration: 2,
      marker: 'm', command: 'c', commandParams: ['p'], delayAfterArrive: 1, maxPower: 0.5, maxSpeed: 10,
    });
    const [m] = mirrorNodes([n]);
    expect(m).toEqual({ ...n, y: -2, dy: -4, heading: -30, dHeading: -5 });
    expect(n.y).toBe(2);
  });

  it('属性：mirrorNodes 是对合（两次等于原路径）且保持长度', () => {
    const r = rng(12);
    for (let i = 0; i < 50; i++) {
      const nodes = randomRoute(r, 1 + Math.floor(r() * 6));
      const m = mirrorNodes(nodes);
      expect(m).toHaveLength(nodes.length);
      expect(mirrorNodes(m)).toStrictEqual(nodes);
    }
    expect(mirrorNodes([])).toEqual([]);
  });
});
