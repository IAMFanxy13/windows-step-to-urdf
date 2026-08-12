import { describe, expect, it } from 'vitest';

import { queueSummary } from '../src/views/anomaly-queue-view.mjs';

describe('exception-first queue presentation', () => {
  it('summarizes validation state with three visual counts', () => {
    expect(queueSummary({ blockers: [{ id: 'b1' }], warnings: [], passed: [{}, {}], info: [] })).toEqual([
      { severity: 'BLOCKER', icon: '🔴', count: 1, label: '必须修复' },
      { severity: 'WARNING', icon: '🟡', count: 0, label: '建议检查' },
      { severity: 'PASS', icon: '🟢', count: 2, label: '已通过' },
    ]);
  });
});
