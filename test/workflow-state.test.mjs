import { describe, expect, it } from 'vitest';
import { createWorkflowState, transitionWorkflow, WORKFLOW_STAGES } from '../src/app/workflow-state.mjs';

describe('product workflow state', () => {
  it('starts with one clear import task and six ordered stages', () => {
    const state = createWorkflowState();
    expect(WORKFLOW_STAGES).toHaveLength(6);
    expect(state.currentStage).toBe('IMPORT');
    expect(state.currentTask.action).toBe('SELECT_STEP');
  });

  it('migrates the legacy combined test/export stage without losing progress', () => {
    const state = createWorkflowState({
      schemaVersion: 1,
      currentStage: 'TEST_EXPORT',
      completedStages: ['IMPORT', 'ANALYZE', 'RESULTS', 'REVIEW'],
    });
    expect(state.schemaVersion).toBe(2);
    expect(state.currentStage).toBe('MOTION_TEST');
    expect(state.completedStages).toEqual(['IMPORT', 'ANALYZE', 'RESULTS', 'REVIEW']);
  });

  it('does not silently skip unfinished stages', () => {
    const state = createWorkflowState();
    expect(() => transitionWorkflow(state, 'RESULTS')).toThrow(/cannot skip/i);
  });

  it('preserves blocker counts instead of presenting false completion', () => {
    let state = transitionWorkflow(createWorkflowState(), 'ANALYZE', { completedStage: 'IMPORT' });
    state = transitionWorkflow(state, 'RESULTS', { completedStage: 'ANALYZE', counts: { blockers: 1, automaticPassed: 12 } });
    expect(state.counts).toMatchObject({ blockers: 1, automaticPassed: 12 });
    expect(state.progressPercent).toBeLessThan(100);
  });
});
