/** 路径规划控制节点。字段与 Kotlin ControlNode 完全一致。可选字段缺省时必须省略，永不输出 null。 */
export interface ControlNode {
  x: number;
  dx: number;
  y: number;
  dy: number;
  heading: number;
  dHeading: number;
  duration: number;
  marker: string;
  command: string;
  commandParams: string[];
  delayAfterArrive: number;
  /** 本段功率上限 [0,1] */
  maxPower: number;
  /** 速度上限 (in/s)，undefined = 不限 */
  maxSpeed?: number | undefined;
  /** 到达速度 (in/s)，0 = 完全停止 */
  endSpeed?: number | undefined;
  /** 到点前制动距离 (in)；设置 endSpeed 时必须 > 0 */
  brakeZoneIn: number;
  /** 制动时前向功率上限 */
  brakeForwardPower?: number | undefined;
}

export function makeNode(partial: Partial<ControlNode> & Pick<ControlNode, 'x' | 'y'>): ControlNode {
  const n: ControlNode = {
    x: partial.x,
    dx: partial.dx ?? 0,
    y: partial.y,
    dy: partial.dy ?? 0,
    heading: partial.heading ?? 0,
    dHeading: partial.dHeading ?? 0,
    duration: partial.duration ?? 1,
    marker: partial.marker ?? '',
    command: partial.command ?? '',
    commandParams: partial.commandParams ?? [],
    delayAfterArrive: partial.delayAfterArrive ?? 0,
    maxPower: partial.maxPower ?? 1,
    brakeZoneIn: partial.brakeZoneIn ?? 0,
  };
  if (partial.maxSpeed !== undefined) n.maxSpeed = partial.maxSpeed;
  if (partial.endSpeed !== undefined) n.endSpeed = partial.endSpeed;
  if (partial.brakeForwardPower !== undefined) n.brakeForwardPower = partial.brakeForwardPower;
  return n;
}

const EPS = 1e-7;
const closeOpt = (a: number | undefined, b: number | undefined) =>
  a === undefined || b === undefined ? a === b : Math.abs(a - b) < EPS;

export function nodesClose(a: ControlNode, b: ControlNode): boolean {
  return (
    Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS &&
    Math.abs(a.dx - b.dx) < EPS && Math.abs(a.dy - b.dy) < EPS &&
    Math.abs(a.heading - b.heading) < EPS && Math.abs(a.dHeading - b.dHeading) < EPS &&
    Math.abs(a.duration - b.duration) < EPS &&
    a.marker === b.marker && a.command === b.command &&
    a.commandParams.length === b.commandParams.length &&
    a.commandParams.every((p, i) => p === b.commandParams[i]) &&
    Math.abs(a.delayAfterArrive - b.delayAfterArrive) < EPS &&
    Math.abs(a.maxPower - b.maxPower) < EPS &&
    closeOpt(a.maxSpeed, b.maxSpeed) && closeOpt(a.endSpeed, b.endSpeed) &&
    Math.abs(a.brakeZoneIn - b.brakeZoneIn) < EPS &&
    closeOpt(a.brakeForwardPower, b.brakeForwardPower)
  );
}

/** 沿 x 轴镜像（y、dy、heading、dHeading 取反），蓝方→红方 */
export function mirrorY(n: ControlNode): ControlNode {
  return { ...n, y: -n.y, dy: -n.dy, heading: -n.heading, dHeading: -n.dHeading };
}

/** 新路径点继承几何与巡航功率，不继承动作/延迟/末端制动 */
export function nextWaypoint(n: ControlNode, x: number, y: number): ControlNode {
  const r: ControlNode = {
    ...n, x, y, marker: '', command: '', commandParams: [],
    delayAfterArrive: 0, brakeZoneIn: 0,
  };
  delete r.endSpeed;
  delete r.brakeForwardPower;
  return r;
}
