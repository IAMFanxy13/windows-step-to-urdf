import { createWorkflowState, setAnalysisTask, setWorkflowMode, transitionWorkflow } from './workflow-state.mjs';

export class WorkflowController {
  #state; #listeners = new Set();
  constructor(initial) { this.#state = createWorkflowState(initial); }
  get state() { return structuredClone(this.#state); }
  subscribe(listener) { this.#listeners.add(listener); listener(this.state); return () => this.#listeners.delete(listener); }
  #commit(next) { this.#state = next; for (const listener of this.#listeners) listener(this.state); return this.state; }
  transition(stage, patch) { return this.#commit(transitionWorkflow(this.#state, stage, patch)); }
  setAnalysisTask(task, status) { return this.#commit(setAnalysisTask(this.#state, task, status)); }
  setMode(mode) { return this.#commit(setWorkflowMode(this.#state, mode)); }
  update(patch) { return this.#commit({ ...this.#state, ...structuredClone(patch) }); }
}
