import { describe, expect, it } from 'vitest';
import { X_MIN_SEC, X_STEP_SEC, Y_MIN_IN, chartAxes } from '../../src/ui/chart';

const s = (t: number, e: number) => ({ t, e });

describe('chartAxes', () => {
  it('常量', () => {
    expect(X_MIN_SEC).toBe(30);
    expect(X_STEP_SEC).toBe(5);
    expect(Y_MIN_IN).toBe(5);
  });

  it('无样本：x 最小 30，y 最小 5', () => {
    expect(chartAxes([])).toEqual({ xMax: 30, yMax: 5 });
  });

  it('x 轴：最小 30，之后按 5s 步进向上取整', () => {
    expect(chartAxes([s(0, 0)]).xMax).toBe(30);
    expect(chartAxes([s(29.9, 0)]).xMax).toBe(30);
    expect(chartAxes([s(30, 0)]).xMax).toBe(30);
    expect(chartAxes([s(30.01, 0)]).xMax).toBe(35);
    expect(chartAxes([s(35, 0)]).xMax).toBe(35);
    expect(chartAxes([s(36, 0)]).xMax).toBe(40);
    expect(chartAxes([s(101, 0)]).xMax).toBe(105);
  });

  it('x 轴取最后一个样本的时间（而不是最大值）', () => {
    expect(chartAxes([s(50, 0), s(10, 0)]).xMax).toBe(30);
    expect(chartAxes([s(1, 0), s(42, 0)]).xMax).toBe(45);
  });

  it('y 轴：最小 5，之后取 5 的倍数向上取整', () => {
    expect(chartAxes([s(0, 0)]).yMax).toBe(5);
    expect(chartAxes([s(0, 4.9)]).yMax).toBe(5);
    expect(chartAxes([s(0, 5)]).yMax).toBe(5);
    expect(chartAxes([s(0, 5.01)]).yMax).toBe(10);
    expect(chartAxes([s(0, 10)]).yMax).toBe(10);
    expect(chartAxes([s(0, 12.3)]).yMax).toBe(15);
    expect(chartAxes([s(0, 99)]).yMax).toBe(100);
  });

  it('y 轴取所有样本中的最大误差', () => {
    expect(chartAxes([s(0, 1), s(1, 17), s(2, 3)]).yMax).toBe(20);
  });

  it('属性：xMax 为 5 的倍数且 >=30 且 >= 最后时间；yMax 为 5 的倍数且 >=5 且 >= 最大误差', () => {
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 200; i++) {
      const n = 1 + Math.floor(rand() * 20);
      const samples = Array.from({ length: n }, (_, k) => s(k * rand() * 10, rand() * 60));
      const { xMax, yMax } = chartAxes(samples);
      expect(xMax % 5).toBe(0);
      expect(xMax).toBeGreaterThanOrEqual(30);
      expect(xMax).toBeGreaterThanOrEqual(samples[n - 1]!.t);
      expect(yMax % 5).toBe(0);
      expect(yMax).toBeGreaterThanOrEqual(5);
      expect(yMax).toBeGreaterThanOrEqual(Math.max(...samples.map((x) => x.e)));
    }
  });
});
