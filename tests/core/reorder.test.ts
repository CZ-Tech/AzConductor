import { describe, expect, it } from 'vitest';
import { duplicateAt, moveItem, slotToIndex } from '../../src/core/reorder';
import { makeNode } from '../../src/core/node';

describe('moveItem', () => {
  it('向后 / 向前移动', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });
  it('无变化或越界时返回原数组', () => {
    const l = ['a', 'b'];
    expect(moveItem(l, 1, 1)).toBe(l);
    expect(moveItem(l, -1, 0)).toBe(l);
    expect(moveItem(l, 0, 2)).toBe(l);
    expect(moveItem(l, 0.5, 1)).toBe(l);
  });
  it('不修改入参', () => {
    const l = ['a', 'b', 'c'];
    moveItem(l, 0, 2);
    expect(l).toEqual(['a', 'b', 'c']);
  });
});

describe('slotToIndex', () => {
  it('槽位换算为移动后的下标', () => {
    expect(slotToIndex(1, 0)).toBe(0);
    expect(slotToIndex(1, 1)).toBe(1); // 原位
    expect(slotToIndex(1, 2)).toBe(1); // 原位
    expect(slotToIndex(1, 4)).toBe(3);
    expect(slotToIndex(3, 0)).toBe(0);
  });
});

describe('duplicateAt', () => {
  const a = makeNode({ x: 1, y: 2, commands: [{ name: 'Foo', params: ['1', '2'] }, { name: 'Foo', params: [] }], marker: 'm', endSpeed: 3, brakeZoneIn: 4 });
  const b = makeNode({ x: 5, y: 6 });

  it('在原点后插入完整副本', () => {
    const r = duplicateAt([a, b], 0);
    expect(r.index).toBe(1);
    expect(r.points).toHaveLength(3);
    expect(r.points[1]).toEqual(a);
    expect(r.points[2]).toBe(b);
  });
  it('副本不与原点共享 commands 或任何 params', () => {
    const r = duplicateAt([a], 0);
    const copy = r.points[1]!;
    expect(copy.commands).not.toBe(a.commands);
    copy.commands.forEach((command, i) => {
      expect(command).not.toBe(a.commands[i]);
      expect(command.params).not.toBe(a.commands[i]!.params);
    });
    copy.commands[0]!.params.push('x');
    copy.commands[1]!.name = 'changed';
    expect(a.commands).toEqual([{ name: 'Foo', params: ['1', '2'] }, { name: 'Foo', params: [] }]);
  });
  it('可选字段缺省时仍然缺省（不产生 undefined 键之外的 null）', () => {
    const r = duplicateAt([b], 0);
    expect(r.points[1]).not.toHaveProperty('endSpeed');
  });
  it('越界返回 null', () => {
    expect(duplicateAt([a], 3).index).toBeNull();
    expect(duplicateAt([a], -1).points).toEqual([a]);
  });
});
