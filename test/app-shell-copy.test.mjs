import { describe, expect, it } from 'vitest';

import { taskPresentation } from '../src/app/app-shell.mjs';
import { createWorkflowState } from '../src/app/workflow-state.mjs';

describe('compact default task copy', () => {
  it('keeps the import instruction to one short action', () => {
    const view = taskPresentation(createWorkflowState());
    expect(view.icon).toBe('📥');
    expect(view.title.length).toBeLessThanOrEqual(12);
    expect(view.instruction).toBe('选择完整机器人 STEP');
    expect(view.reason.length).toBeGreaterThan(0);
  });

  it('keeps every main instruction short', () => {
    for (const stage of ['IMPORT', 'ANALYZE', 'RESULTS', 'REVIEW', 'MOTION_TEST', 'EXPORT']) {
      const view = taskPresentation(createWorkflowState({ currentStage: stage }));
      expect(view.instruction.length).toBeLessThanOrEqual(14);
    }
  });
});
