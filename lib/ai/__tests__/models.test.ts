import { describe, it, expect } from 'vitest';
import { MODELS, TASKS, buildModelParams, profileFor, shouldCache, thinksFor } from '../models';
import type { Task } from '../provider';

const ALL_TASKS = Object.keys(TASKS) as Task[];

describe('model parameter rules', () => {
  it('every task maps to a model we have a profile for', () => {
    for (const task of ALL_TASKS) {
      expect(() => profileFor(task)).not.toThrow();
    }
  });

  it('always sends `effort`, so a model swap cannot silently change the default', () => {
    // Haiku 5.5 defaults to medium, Sonnet 5.5 to high.
    for (const task of ALL_TASKS) {
      const params = buildModelParams(task);
      expect(MODELS[params.model].supportsEffort).toBe(true);
      expect(params.output_config?.effort, `task '${task}'`).toBe(TASKS[task].effort);
    }
  });

  it('only disables thinking where the model accepts it', () => {
    // Sonnet 5.5 returns 400 for thinking: disabled; Haiku 5.5 accepts it at effort high or below.
    for (const task of ALL_TASKS) {
      const params = buildModelParams(task);
      if (params.thinking) {
        expect(MODELS[params.model].canDisableThinking, `task '${task}'`).toBe(true);
        expect(['low', 'medium', 'high']).toContain(TASKS[task].effort);
      }
    }
    expect(buildModelParams('classify-expense').thinking).toEqual({ type: 'disabled' });
    expect(buildModelParams('extract-holdings').thinking).toBeUndefined();
  });

  it('never sends sampling parameters at all', () => {
    // Haiku 5.5 and Sonnet 5.5 return 400 for non-default temperature / top_p / top_k. The old OpenCode Zen
    // call sent temperature: 0.8, which is why it could not simply be repointed.
    for (const task of ALL_TASKS) {
      const params = buildModelParams(task) as Record<string, unknown>;
      expect(params.temperature).toBeUndefined();
      expect(params.top_p).toBeUndefined();
      expect(params.top_k).toBeUndefined();
    }
  });

  it('sends `effort` where it is supported and configured', () => {
    const params = buildModelParams('extract-receipt');
    expect(MODELS[params.model].supportsEffort).toBe(true);
    expect(params.output_config?.effort).toBe('medium');
  });

  it('gives tasks that think room in max_tokens', () => {
    // When thinking runs, max_tokens caps thinking PLUS output, so a tight budget truncates
    // the answer mid-response.
    for (const task of ALL_TASKS) {
      const params = buildModelParams(task);
      if (thinksFor(task)) {
        expect(params.max_tokens, `task '${task}'`).toBeGreaterThanOrEqual(8_000);
      }
    }
  });

  it('runs everyday work on Haiku and only the holdings read on Sonnet', () => {
    for (const t of ['classify-expense', 'extract-receipt', 'insights'] as Task[]) {
      expect(TASKS[t].model, `task '${t}'`).toBe('claude-haiku-5-5');
    }
    expect(TASKS['extract-holdings'].model).toBe('claude-sonnet-5-5');
  });

  it('only caches a prefix that can clear the model minimum', () => {
    // Both minimums are 512 tokens; marking a shorter prefix anyway just pays the write
    // premium for nothing.
    expect(shouldCache('classify-expense', 400)).toBe(false);
    expect(shouldCache('classify-expense', 600)).toBe(true);
    expect(shouldCache('extract-holdings', 2_000)).toBe(true);
  });

  it('every task has a timeout so a hung request degrades instead of hanging the UI', () => {
    for (const task of ALL_TASKS) {
      expect(TASKS[task].timeoutMs, `task '${task}'`).toBeGreaterThan(0);
      expect(TASKS[task].timeoutMs).toBeLessThanOrEqual(120_000);
    }
  });

  it('bounds worst-case wall clock, accounting for retries', () => {
    // Retries multiply the timeout. With the SDK default of 2 retries a 15s timeout took a
    // measured 48s against a stalled endpoint — far too long for a request the user is
    // waiting on when a fallback answer already exists.
    for (const task of ALL_TASKS) {
      const { timeoutMs, maxRetries } = TASKS[task];
      const worstCase = timeoutMs * (maxRetries + 1);
      expect(worstCase, `task '${task}' worst case`).toBeLessThanOrEqual(180_000);
    }
  });

  it('does not retry tasks that have a local fallback', () => {
    // These all degrade to a non-AI path, so a retry only adds latency.
    for (const task of ['classify-expense', 'extract-holdings', 'insights'] as Task[]) {
      expect(TASKS[task].maxRetries, `task '${task}'`).toBe(0);
    }
  });

  it('keeps interactive suggestion latency low', () => {
    // Typing-time suggestion: worst case must stay well under a plausible attention span.
    const { timeoutMs, maxRetries } = TASKS['classify-expense'];
    expect(timeoutMs * (maxRetries + 1)).toBeLessThanOrEqual(20_000);
  });
});
