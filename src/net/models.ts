/** Wire DTOs of Network V2 (port of ApiModels.kt) with strict-but-forgiving decoders. */

export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecodeError';
  }
}

export type OpModePhase = 'STOPPED' | 'INIT' | 'RUNNING';
export type ExecutionState = 'NOT_READY' | 'IDLE' | 'RUNNING';

export interface HealthInfo { status: string; protocol: number; sessionOwned: boolean }
export interface SessionOpenResponse { token: string; expiresInMs: number }
export interface RouteManifestEntry { name: string; revision: number }
export interface RouteManifest { routes: RouteManifestEntry[]; changeRevision: number }
/** `json` is the raw response text (opaque to this layer). */
export interface RobotRoutePayload { name: string; revision: number; json: string }
export interface RouteWriteResponse { name: string; revision: number }
export interface ExecutionSnapshot { state: ExecutionState; requestId: number; subject: string | null; revision: number }
export interface CommandDescriptor { name: string; paramNames: string[]; paramTypes: string[] }
export interface CommandCatalog { revision: number; commands: CommandDescriptor[] }
export interface PoseEvent { seq: number; tNanos: number; x: number; y: number; heading: number }
export interface RuntimeEvent { seq: number; opModeActive: boolean; opModeName: string | null }
export interface RevisionEvent { revision: number }
export interface HeartbeatEvent { t: number }
export interface HelloEvent { protocol: number; poseHz: number; sessionTimeoutMs: number }
export interface OpModeDescriptor { name: string; group: string }
export interface OpModeList { opModes: OpModeDescriptor[] }
export interface OpModeSnapshot { revision: number; controllerAvailable: boolean; phase: OpModePhase; activeName: string | null }
export interface OpModeActionResponse { accepted: boolean; action: string; name: string }
export interface RuntimeSnapshot { runtime: RuntimeEvent; pose: PoseEvent }

/** Error body of any non-2xx response (all fields optional). */
export interface ApiErrorBody {
  error?: string;
  message?: string;
  owner?: string;
  retryAfterMs?: number;
  actual?: number;
}

type Obj = Record<string, unknown>;

function obj(v: unknown, what: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new DecodeError(`${what}: expected object`);
  return v as Obj;
}
function num(o: Obj, k: string, def?: number): number {
  const v = o[k];
  if (v === undefined || v === null) {
    if (def !== undefined) return def;
    throw new DecodeError(`missing number '${k}'`);
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new DecodeError(`'${k}' is not a number`);
  return v;
}
function str(o: Obj, k: string, def?: string): string {
  const v = o[k];
  if (v === undefined || v === null) {
    if (def !== undefined) return def;
    throw new DecodeError(`missing string '${k}'`);
  }
  if (typeof v !== 'string') throw new DecodeError(`'${k}' is not a string`);
  return v;
}
function strOrNull(o: Obj, k: string): string | null {
  const v = o[k];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new DecodeError(`'${k}' is not a string`);
  return v;
}
function bool(o: Obj, k: string, def?: boolean): boolean {
  const v = o[k];
  if (v === undefined || v === null) {
    if (def !== undefined) return def;
    throw new DecodeError(`missing boolean '${k}'`);
  }
  if (typeof v !== 'boolean') throw new DecodeError(`'${k}' is not a boolean`);
  return v;
}
function arr(o: Obj, k: string): unknown[] {
  const v = o[k];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new DecodeError(`'${k}' is not an array`);
  return v;
}
function strArr(o: Obj, k: string): string[] {
  return arr(o, k).map((x) => {
    if (typeof x !== 'string') throw new DecodeError(`'${k}' contains a non-string`);
    return x;
  });
}

const PHASES: readonly string[] = ['STOPPED', 'INIT', 'RUNNING'];
const EXEC_STATES: readonly string[] = ['NOT_READY', 'IDLE', 'RUNNING'];

export function decodeHealth(raw: unknown): HealthInfo {
  const o = obj(raw, 'health');
  return { status: str(o, 'status', 'ok'), protocol: num(o, 'protocol', 2), sessionOwned: bool(o, 'sessionOwned', false) };
}
export function decodeSessionOpen(raw: unknown): SessionOpenResponse {
  const o = obj(raw, 'session');
  return { token: str(o, 'token'), expiresInMs: num(o, 'expiresInMs') };
}
export function decodeRouteManifest(raw: unknown): RouteManifest {
  const o = obj(raw, 'routes');
  return {
    routes: arr(o, 'routes').map((e) => {
      const r = obj(e, 'route entry');
      return { name: str(r, 'name'), revision: num(r, 'revision') };
    }),
    changeRevision: num(o, 'changeRevision', 0),
  };
}
export function decodeRouteWrite(raw: unknown): RouteWriteResponse {
  const o = obj(raw, 'route write');
  return { name: str(o, 'name'), revision: num(o, 'revision') };
}
export function decodeExecution(raw: unknown): ExecutionSnapshot {
  const o = obj(raw, 'execution');
  const state = str(o, 'state');
  if (!EXEC_STATES.includes(state)) throw new DecodeError(`unknown execution state '${state}'`);
  return { state: state as ExecutionState, requestId: num(o, 'requestId', 0), subject: strOrNull(o, 'subject'), revision: num(o, 'revision', 0) };
}
export function decodeCommandCatalog(raw: unknown): CommandCatalog {
  const o = obj(raw, 'commands');
  return {
    revision: num(o, 'revision', 0),
    commands: arr(o, 'commands').map((e) => {
      const c = obj(e, 'command');
      return { name: str(c, 'name'), paramNames: strArr(c, 'paramNames'), paramTypes: strArr(c, 'paramTypes') };
    }),
  };
}
export function decodePose(raw: unknown): PoseEvent {
  const o = obj(raw, 'pose');
  return { seq: num(o, 'seq'), tNanos: num(o, 'tNanos'), x: num(o, 'x'), y: num(o, 'y'), heading: num(o, 'heading') };
}
export function decodeRuntime(raw: unknown): RuntimeEvent {
  const o = obj(raw, 'runtime');
  return { seq: num(o, 'seq'), opModeActive: bool(o, 'opModeActive'), opModeName: strOrNull(o, 'opModeName') };
}
export function decodeRevision(raw: unknown): RevisionEvent {
  return { revision: num(obj(raw, 'revision'), 'revision') };
}
export function decodeHeartbeat(raw: unknown): HeartbeatEvent {
  return { t: num(obj(raw, 'heartbeat'), 't') };
}
export function decodeHello(raw: unknown): HelloEvent {
  const o = obj(raw, 'hello');
  return { protocol: num(o, 'protocol', 2), poseHz: num(o, 'poseHz', 60), sessionTimeoutMs: num(o, 'sessionTimeoutMs', 10_000) };
}
export function decodeOpModeList(raw: unknown): OpModeList {
  const o = obj(raw, 'opmodes');
  return {
    opModes: arr(o, 'opModes').map((e) => {
      const d = obj(e, 'opmode');
      return { name: str(d, 'name'), group: str(d, 'group', '') };
    }),
  };
}
export function decodeOpModeSnapshot(raw: unknown): OpModeSnapshot {
  const o = obj(raw, 'opmode');
  const phase = str(o, 'phase', 'STOPPED');
  if (!PHASES.includes(phase)) throw new DecodeError(`unknown opmode phase '${phase}'`);
  return {
    revision: num(o, 'revision', 0),
    controllerAvailable: bool(o, 'controllerAvailable', false),
    phase: phase as OpModePhase,
    activeName: strOrNull(o, 'activeName'),
  };
}
export function decodeOpModeAction(raw: unknown): OpModeActionResponse {
  const o = obj(raw, 'opmode action');
  return { accepted: bool(o, 'accepted', false), action: str(o, 'action', ''), name: str(o, 'name', '') };
}
export function decodeRuntimeSnapshot(raw: unknown): RuntimeSnapshot {
  const o = obj(raw, 'runtime snapshot');
  return { runtime: decodeRuntime(o['runtime']), pose: decodePose(o['pose']) };
}

/** Best-effort error-body parse; never throws. */
export function decodeErrorBody(text: string): ApiErrorBody {
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    const o = raw as Obj;
    const out: ApiErrorBody = {};
    if (typeof o['error'] === 'string') out.error = o['error'];
    if (typeof o['message'] === 'string') out.message = o['message'];
    if (typeof o['owner'] === 'string') out.owner = o['owner'];
    if (typeof o['retryAfterMs'] === 'number') out.retryAfterMs = o['retryAfterMs'];
    if (typeof o['actual'] === 'number') out.actual = o['actual'];
    return out;
  } catch {
    return {};
  }
}
