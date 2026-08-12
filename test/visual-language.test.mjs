import { describe, expect, it } from 'vitest';

import { visualForSeverity, visualForStage } from '../src/app/visual-language.mjs';

describe('default-mode visual language', () => {
  it('gives every workflow stage a short icon label', () => {
    for (const id of ['IMPORT', 'ANALYZE', 'RESULTS', 'REVIEW', 'MOTION_TEST', 'EXPORT']) {
      const visual = visualForStage(id);
      expect(visual.icon).toMatch(/\p{Extended_Pictographic}/u);
      expect(visual.shortLabel.length).toBeLessThanOrEqual(6);
    }
  });

  it('maps validation severity to an icon and mechanical-language label', () => {
    expect(visualForSeverity('BLOCKER')).toEqual({ icon: '🔴', label: '必须修复' });
    expect(visualForSeverity('WARNING')).toEqual({ icon: '🟡', label: '建议检查' });
    expect(visualForSeverity('PASS')).toEqual({ icon: '🟢', label: '已通过' });
  });
});
