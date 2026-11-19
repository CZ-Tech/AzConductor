/** 机器配置读取：制动减速度取机器人调参表中的 `Auto.SAFE_BRAKE_DECEL`。 */
import { BRAKE_DECELERATION_FIELD, DEFAULT_BRAKE_DECELERATION } from '../core/brake';
import { connState, getConnection } from './session';

export interface BrakeDeceleration {
  value: number;
  /** true = 来自机器人当前调参；false = 离线使用的默认值。 */
  live: boolean;
}

export const OFFLINE_BRAKE_DECELERATION: BrakeDeceleration = { value: DEFAULT_BRAKE_DECELERATION, live: false };

/** 读取机器人当前制动减速度；未连接或读不到时回退到离线默认值。 */
export async function loadBrakeDeceleration(): Promise<BrakeDeceleration> {
  if (connState.value.kind !== 'connected') return OFFLINE_BRAKE_DECELERATION;
  const connection = getConnection();
  if (!connection) return OFFLINE_BRAKE_DECELERATION;
  try {
    const r = await connection.api.tuning();
    if (!r.ok) return OFFLINE_BRAKE_DECELERATION;
    const value = r.value.fields.find((f) => f.name === BRAKE_DECELERATION_FIELD)?.value;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return { value, live: true };
  } catch {
    // 旧固件没有调参端点：用离线默认值并明确标注。
  }
  return OFFLINE_BRAKE_DECELERATION;
}
