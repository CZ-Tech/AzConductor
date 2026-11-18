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
/** `null` means no known default, not necessarily required; each array has one entry per parameter. */
export interface CommandParameterSignature {
  paramNames: string[];
  paramTypes: string[];
  paramDefaults: (string | null)[];
}
/** The base signature is the longest one. New metadata is an all-or-nothing wire extension. */
export interface CommandDescriptor extends CommandParameterSignature {
  name: string;
  signatures?: CommandParameterSignature[];
  acceptedArgCounts?: number[];
  hasUnifiedSignature?: boolean;
  requiredParamCount?: number | null;
  paramRequired?: boolean[] | null;
}
export interface CommandCatalog { revision: number; commands: CommandDescriptor[] }
export interface CommandRunResponse { accepted: boolean; name: string }
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
/** `text` is the Driver Station display; number null represents NaN/infinity. */
export type TelemetryItem = { caption: string; text: string; unit?: string } & (
  | { type: 'number'; value: number | null }
  | { type: 'boolean'; value: boolean }
  | { type: 'text'; value: null }
);
export interface TelemetryLine { caption: string | null; items: TelemetryItem[] }
export interface TelemetryFrame { seq: number; tNanos: number; lines: TelemetryLine[] }
export interface TelemetrySnapshot { frame: TelemetryFrame; logSeq: number }
export type TuningValue = number | boolean | string;
export interface TuningField {
  name: string;
  group: string;
  type: 'double' | 'float' | 'int' | 'long' | 'boolean' | 'String' | 'enum';
  value: TuningValue;
  defaultValue: TuningValue;
  options?: string[];
}
export interface TuningSnapshot { revision: number; fields: TuningField[] }

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

/** `paramDefaults` is absent on older firmware: every parameter is then required. Always `count` entries. */
function defaultsArr(o: Obj, count: number): (string | null)[] {
  return Array.from({ length: count }, (_, i) => {
    const v = arr(o, 'paramDefaults')[i];
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string') throw new DecodeError("'paramDefaults' contains a non-string");
    return v;
  });
}

const PHASES: readonly string[] = ['STOPPED', 'INIT', 'RUNNING'];
const EXEC_STATES: readonly string[] = ['NOT_READY', 'IDLE', 'RUNNING'];

export function decodeHealth(raw: unknown): HealthInfo {
  const o = obj(raw, 'health');
  return { status: str(o, 'status', 'ok'), protocol: num(o, 'protocol', 2), sessionOwned: bool(o, 'sessionOwned', false) };
}
export function decodeTuning(raw: unknown): TuningSnapshot {
  const o = obj(raw, 'tuning');
  const types = ['double', 'float', 'int', 'long', 'boolean', 'String', 'enum'];
  return {
    revision: num(o, 'revision'),
    fields: arr(o, 'fields').map((v) => {
      const f = obj(v, 'tuning field');
      const type = str(f, 'type');
      if (!types.includes(type)) throw new DecodeError('unsupported tuning type: ' + type);
      const value = f['value'], defaultValue = f['defaultValue'];
      const valid = (x: unknown): x is TuningValue => {
        if (type === 'boolean') return typeof x === 'boolean';
        if (type === 'enum' || type === 'String') return typeof x === 'string';
        return typeof x === 'number' && Number.isFinite(x);
      };
      if (!valid(value) || !valid(defaultValue)) throw new DecodeError('invalid tuning value');
      const field: TuningField = {
        name: str(f, 'name'), group: str(f, 'group'),
        type: type as TuningField['type'], value, defaultValue,
      };
      if (type === 'enum') field.options = strArr(f, 'options');
      return field;
    }),
  };
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
const COMMAND_METADATA_KEYS = ['signatures', 'acceptedArgCounts', 'hasUnifiedSignature', 'requiredParamCount', 'paramRequired'] as const;

function sameItems(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && Array.from(a).every((v, i) => v === b[i]);
}

/** Unlike the legacy decoder, new signatures must carry all three equally sized arrays. */
function decodeCommandSignature(o: Obj): CommandParameterSignature {
  for (const key of ['paramNames', 'paramTypes', 'paramDefaults']) {
    if (!Array.isArray(o[key])) throw new DecodeError(`command signature: missing array '${key}'`);
  }
  const strings = (key: string): string[] => Array.from(arr(o, key), (v) => {
    if (typeof v !== 'string') throw new DecodeError(`command signature: '${key}' contains a non-string`);
    return v;
  });
  const paramNames = strings('paramNames');
  const paramTypes = strings('paramTypes');
  const rawDefaults = arr(o, 'paramDefaults');
  if (paramTypes.length !== paramNames.length || rawDefaults.length !== paramNames.length) {
    throw new DecodeError('command signature: inconsistent parameter array lengths');
  }
  const paramDefaults = Array.from(rawDefaults, (v) => {
    if (v !== null && typeof v !== 'string') throw new DecodeError('command signature: invalid default');
    return v;
  });
  return { paramNames, paramTypes, paramDefaults };
}

function decodeCommandDescriptor(raw: unknown): CommandDescriptor {
  const c = obj(raw, 'command');
  const name = str(c, 'name');
  if (!COMMAND_METADATA_KEYS.some((key) => key in c)) {
    const paramNames = strArr(c, 'paramNames');
    return { name, paramNames, paramTypes: strArr(c, 'paramTypes'), paramDefaults: defaultsArr(c, paramNames.length) };
  }
  if (!COMMAND_METADATA_KEYS.every((key) => key in c)) throw new DecodeError('command metadata: incomplete field group');
  const base = decodeCommandSignature(c);
  const rawSignatures = c['signatures'];
  if (!Array.isArray(rawSignatures) || rawSignatures.length === 0) throw new DecodeError('command metadata: expected nonempty signatures');
  const signatures = Array.from(rawSignatures, (v) => decodeCommandSignature(obj(v, 'command signature')));
  const acceptedArgCounts = signatures.map((s) => s.paramNames.length);
  if (acceptedArgCounts.some((n, i) => i > 0 && n <= (acceptedArgCounts[i - 1] as number))) {
    throw new DecodeError('command metadata: signatures must have unique, increasing arity');
  }
  const longest = signatures[signatures.length - 1] as CommandParameterSignature;
  for (const key of ['paramNames', 'paramTypes', 'paramDefaults'] as const) {
    if (!sameItems(base[key], longest[key])) throw new DecodeError('command metadata: base is not the longest signature');
  }
  if (!Array.isArray(c['acceptedArgCounts']) || !sameItems(c['acceptedArgCounts'], acceptedArgCounts)) {
    throw new DecodeError('command metadata: acceptedArgCounts does not match signatures');
  }
  const min = acceptedArgCounts[0] as number;
  const hasUnifiedSignature = acceptedArgCounts.every((n, i) => n === min + i)
    && signatures.every((s) => s.paramNames.every((v, i) => v === longest.paramNames[i])
      && s.paramTypes.every((v, i) => v === longest.paramTypes[i]));
  if (c['hasUnifiedSignature'] !== hasUnifiedSignature) throw new DecodeError('command metadata: incorrect unified signature flag');
  const requiredParamCount = hasUnifiedSignature ? min : null;
  const paramRequired = hasUnifiedSignature ? longest.paramNames.map((_, i) => i < min) : null;
  if (c['requiredParamCount'] !== requiredParamCount) throw new DecodeError('command metadata: incorrect requiredParamCount');
  const rawRequired = c['paramRequired'];
  if (paramRequired === null ? rawRequired !== null : !Array.isArray(rawRequired) || !sameItems(rawRequired, paramRequired)) {
    throw new DecodeError('command metadata: incorrect paramRequired flags');
  }
  return { name, ...base, signatures, acceptedArgCounts, hasUnifiedSignature, requiredParamCount, paramRequired };
}

export function decodeCommandCatalog(raw: unknown): CommandCatalog {
  const o = obj(raw, 'commands');
  return { revision: num(o, 'revision', 0), commands: arr(o, 'commands').map(decodeCommandDescriptor) };
}
export function decodeCommandRun(raw: unknown): CommandRunResponse {
  const o = obj(raw, 'command run');
  return { accepted: bool(o, 'accepted', false), name: str(o, 'name', '') };
}
export function decodeTelemetryFrame(raw: unknown): TelemetryFrame {
  const o = obj(raw, 'telemetry frame');
  return {
    seq: num(o, 'seq'), tNanos: num(o, 'tNanos'),
    lines: arr(o, 'lines').map((rawLine) => {
      const line = obj(rawLine, 'telemetry line');
      return {
        caption: strOrNull(line, 'caption'),
        items: arr(line, 'items').map((rawItem): TelemetryItem => {
          const item = obj(rawItem, 'telemetry item');
          const common = { caption: str(item, 'caption'), text: str(item, 'text'),
            ...(item['unit'] !== undefined ? { unit: str(item, 'unit') } : {}) };
          const type = str(item, 'type');
          const value = item['value'];
          if (type === 'number' && (value === null || typeof value === 'number' && Number.isFinite(value))) {
            return { ...common, type, value };
          }
          if (type === 'boolean' && typeof value === 'boolean') return { ...common, type, value };
          if (type === 'text' && value === null) return { ...common, type, value };
          throw new DecodeError('invalid telemetry item type/value');
        }),
      };
    }),
  };
}
export function decodeTelemetrySnapshot(raw: unknown): TelemetrySnapshot {
  const o = obj(raw, 'telemetry snapshot');
  return { frame: decodeTelemetryFrame(o['frame']), logSeq: num(o, 'logSeq') };
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
