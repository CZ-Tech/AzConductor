/** 按顺序触发的普通目录命令；不解释 DSL。 */
export interface NodeCommand {
  name: string;
  params: string[];
}

/** 深复制命令列表及每条命令的参数，供编辑器和复制操作使用。 */
export function cloneCommands(commands: readonly NodeCommand[]): NodeCommand[] {
  return commands.map(({ name, params }) => ({ name, params: [...params] }));
}

/** 路径规划控制节点。可选字段缺省时必须省略，永不输出 null。 */
export interface ControlNode {
  x: number;
  dx: number;
  y: number;
  dy: number;
  heading: number;
  dHeading: number;
  duration: number;
  marker: string;
  commands: NodeCommand[];
  delayAfterArrive: number;
  /** 本段功率上限 [0,1] */
  maxPower: number;
  /** 速度上限 (in/s)，undefined = 不限 */
  maxSpeed?: number | undefined;
  /** 到达速度 (in/s)，0 = 完全停止 */
  endSpeed?: number | undefined;
  /** 到点前制动距离 (in)；缺省时自动计算，0 和正数为显式值 */
  brakeZoneIn?: number | undefined;
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
    commands: cloneCommands(partial.commands ?? []),
    delayAfterArrive: partial.delayAfterArrive ?? 0,
    maxPower: partial.maxPower ?? 1,
  };
  if (partial.brakeZoneIn !== undefined) n.brakeZoneIn = partial.brakeZoneIn;
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
    a.marker === b.marker && a.commands.length === b.commands.length &&
    a.commands.every((c, i) => {
      const other = b.commands[i];
      return other !== undefined && c.name === other.name &&
        c.params.length === other.params.length && c.params.every((p, j) => p === other.params[j]);
    }) &&
    Math.abs(a.delayAfterArrive - b.delayAfterArrive) < EPS &&
    Math.abs(a.maxPower - b.maxPower) < EPS &&
    closeOpt(a.maxSpeed, b.maxSpeed) && closeOpt(a.endSpeed, b.endSpeed) &&
    closeOpt(a.brakeZoneIn, b.brakeZoneIn) &&
    closeOpt(a.brakeForwardPower, b.brakeForwardPower)
  );
}

/** 沿 x 轴镜像（y、dy、heading、dHeading 取反），蓝方→红方 */
export function mirrorY(n: ControlNode): ControlNode {
  return { ...n, commands: cloneCommands(n.commands), y: -n.y, dy: -n.dy, heading: -n.heading, dHeading: -n.dHeading };
}

/** 绕场地原点旋转 180°；dHeading 不变。 */
export function rotate180(n: ControlNode): ControlNode {
  let heading = n.heading + 180;
  while (heading <= -180) heading += 360;
  while (heading > 180) heading -= 360;
  return { ...n, commands: cloneCommands(n.commands), x: -n.x, y: -n.y, dx: -n.dx, dy: -n.dy, heading };
}

/** 新路径点继承几何与巡航功率，不继承动作/延迟/末端制动 */
export function nextWaypoint(n: ControlNode, x: number, y: number): ControlNode {
  const r: ControlNode = {
    ...n, x, y, marker: '', commands: [], delayAfterArrive: 0,
  };
  delete r.endSpeed;
  delete r.brakeZoneIn;
  delete r.brakeForwardPower;
  return r;
}
