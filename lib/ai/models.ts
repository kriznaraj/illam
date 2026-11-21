/**
 * Task → model mapping, and the per-model parameter rules.
 *
 * The capability flags here are not stylistic preferences — sending an unsupported
 * parameter is a hard 400:
 *
 *   - claude-haiku-5-5 and claude-sonnet-5-5 reject non-default `temperature` / `top_p` /
 *     `top_k`, and any `budget_tokens`.
 *   - claude-sonnet-5-5 rejects `thinking: {type: 'disabled'}` outright; claude-haiku-5-5
 *     accepts it, but only at effort `high` or below.
 *   - Both think by default, so max_tokens has to cover the thinking as well as the answer.
 *
 * The old OpenCode Zen call sent `temperature: 0.8`, which is why it could not simply be
 * repointed at Claude. `buildModelParams` below is the single place that knows these rules,
 * and `models.test.ts` asserts them.
 */
import type { Task } from './provider';

export type ModelProfile = {
  id: string;
  /** `output_config.effort` is accepted. */
  supportsEffort: boolean;
  /** `temperature` / `top_p` / `top_k` are accepted. */
  supportsSampling: boolean;
  /** Thinking runs unless explicitly disabled — means max_tokens must cover thinking too. */
  thinkingOnByDefault: boolean;
  /** `thinking: {type: 'disabled'}` is accepted (at effort `high` or below). */
  canDisableThinking: boolean;
  /** Prompt-cache minimum. A cachePrefix shorter than this silently will not cache. */
  cacheMinTokens: number;
};

export const MODELS: Record<string, ModelProfile> = {
  // $0.10 / $0.50 per Mtok for prompts up to 100K tokens. The everyday model: picking 1 of
  // ~23 labels, reading an alert, summarising precomputed aggregates.
  'claude-haiku-5-5': {
    id: 'claude-haiku-5-5',
    supportsEffort: true,
    supportsSampling: false,
    thinkingOnByDefault: true,
    canDisableThinking: true,
    cacheMinTokens: 512,
  },
  // $2 / $10 per Mtok. Kept for the reads where a misread number silently corrupts
  // holdings — a few calls a month, so the price difference is pennies.
  'claude-sonnet-5-5': {
    id: 'claude-sonnet-5-5',
    supportsEffort: true,
    supportsSampling: false,
    thinkingOnByDefault: true,
    canDisableThinking: false,
    cacheMinTokens: 512,
  },
};

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type TaskConfig = {
  model: string;
  /**
   * Always set: Haiku 5.5 defaults to `medium` and Sonnet 5.5 to `high`, so leaving it out
   * means a model swap silently changes the spend.
   */
  effort: Effort;
  /** Turn thinking off — for lookups, where it only adds latency and tokens. */
  thinkingOff?: boolean;
  maxTokens: number;
  timeoutMs: number;
  /**
   * SDK retry count. This multiplies wall-clock time: the SDK's default of 2 means a
   * stalled endpoint takes 3 x timeoutMs before it gives up (measured at 48s for a 15s
   * timeout). Set 0 where a good fallback already exists and latency is user-visible.
   */
  maxRetries: number;
};

/**
 * Economical by design: Haiku does everything that happens every day; Sonnet only the
 * monthly holdings read, where a misread number silently corrupts financial records.
 */
export const TASKS: Record<Task, TaskConfig> = {
  // High volume (every expense), trivially easy, so no thinking.
  // No retries: the keyword matcher already answered, and this runs while the user types —
  // a retry would just make them wait longer for an answer we can do without.
  'classify-expense': {
    model: 'claude-haiku-5-5', effort: 'low', thinkingOff: true, maxTokens: 1024, timeoutMs: 15_000, maxRetries: 0,
  },

  // Crumpled thermal receipts. One retry: the user is waiting on a real result and there is
  // no fallback, so a transient blip is worth retrying. Every field is confirmed by hand.
  'extract-receipt': {
    model: 'claude-haiku-5-5', effort: 'medium', maxTokens: 8_000, timeoutMs: 45_000, maxRetries: 1,
  },

  // Multi-page CAS PDFs with dense tables; the largest output we request.
  // No retry — the regex parser is standing by, so failing fast is better than waiting twice.
  'extract-holdings': {
    model: 'claude-sonnet-5-5', effort: 'low', maxTokens: 16_000, timeoutMs: 90_000, maxRetries: 0,
  },

  // Once a month and cached; summarising precomputed aggregates.
  // No retry — the rule-based engine is the fallback.
  insights: {
    model: 'claude-haiku-5-5', effort: 'medium', maxTokens: 8_000, timeoutMs: 60_000, maxRetries: 0,
  },

  // Deciding what a waiting bank transfer was, from its statement line and the household's
  // history. A money decision applied without asking (when its quoted evidence checks out), so
  // the capable model — a few calls a month. No retry: the transfer simply waits for the next run.
  'resolve-transfer': {
    model: 'claude-sonnet-5-5', effort: 'low', maxTokens: 8_000, timeoutMs: 25_000, maxRetries: 0,
  },
};

export function profileFor(task: Task): ModelProfile {
  const cfg = TASKS[task];
  const profile = MODELS[cfg.model];
  if (!profile) throw new Error(`No model profile for '${cfg.model}' (task '${task}')`);
  return profile;
}

/**
 * Build the model-specific slice of a Messages request, omitting anything the target
 * model would reject. Returns a plain object so it can be asserted in tests without a client.
 */
export type ModelParams = {
  model: string;
  max_tokens: number;
  output_config?: { effort: Effort };
  thinking?: { type: 'disabled' };
};

const EFFORT_ORDER: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function buildModelParams(task: Task): ModelParams {
  const cfg = TASKS[task];
  const profile = profileFor(task);

  const params: ModelParams = {
    model: cfg.model,
    max_tokens: cfg.maxTokens,
  };

  if (profile.supportsEffort) {
    params.output_config = { effort: cfg.effort };
  }

  // Disabling thinking is a 400 on Sonnet 5.5, and on Haiku 5.5 above effort `high`.
  if (
    cfg.thinkingOff &&
    profile.canDisableThinking &&
    EFFORT_ORDER.indexOf(cfg.effort) <= EFFORT_ORDER.indexOf('high')
  ) {
    params.thinking = { type: 'disabled' };
  }

  // Note: no temperature / top_p / top_k is ever set. Both models reject non-default values,
  // and for extraction work determinism is better served by a tight schema than by sampling knobs.

  return params;
}

/** Whether thinking runs for this task — it then shares max_tokens with the answer. */
export function thinksFor(task: Task): boolean {
  return profileFor(task).thinkingOnByDefault && buildModelParams(task).thinking === undefined;
}

/** Whether it is worth attaching a cache breakpoint for a prefix of this size. */
export function shouldCache(task: Task, approxPrefixTokens: number): boolean {
  return approxPrefixTokens >= profileFor(task).cacheMinTokens;
}
