/** 控制点列表的纯函数编辑：重排与复制（不依赖 DOM / UI 框架）。 */
import { cloneCommands, type ControlNode } from './node';

/** 把 from 处的元素移动到 to（to 为移动后的最终下标）。越界或无变化时返回原数组。 */
export function moveItem<T>(list: readonly T[], from: number, to: number): readonly T[] {
  const n = list.length;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return list;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** 拖放"插入槽位"（0..length，表示插在第 slot 项之前）换算成移动后的最终下标。 */
export function slotToIndex(from: number, slot: number): number {
  return slot > from ? slot - 1 : slot;
}

/**
 * 在 index 之后插入一份完整副本（含动作、标记、延迟等全部字段）。
 * 返回新数组与副本下标；index 越界时原样返回、下标为 null。
 */
export function duplicateAt(
  list: readonly ControlNode[], index: number,
): { points: ControlNode[]; index: number | null } {
  const src = list[index];
  if (!src) return { points: [...list], index: null };
  const copy: ControlNode = { ...src, commands: cloneCommands(src.commands) };
  const points = [...list];
  points.splice(index + 1, 0, copy);
  return { points, index: index + 1 };
}
