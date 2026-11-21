/**
 * The AI port.
 *
 * This file defines what the app needs from a language model. It deliberately contains
 * NO vendor types — swapping providers means writing one new file that implements
 * `LLMProvider`, and nothing outside `lib/ai/` changes.
 *
 * Two rules the rest of the codebase depends on:
 *
 *  1. Every call is structured. `schema` is required, so callers get a typed object or a
 *     typed error — never a string that has to be hand-parsed. (The previous integration
 *     stripped markdown fences with a regex and `JSON.parse`d whatever came out.)
 *
 *  2. Failure is a value, not an exception. `complete()` never throws; it returns
 *     `{ok: false}` with a machine-readable `kind`. Callers branch on it to fall back to
 *     their non-AI path. The previous integration returned a bare `null` for "no key",
 *     "HTTP 500" and "bad JSON" alike, which made graceful degradation impossible.
 */
import type { z } from 'zod';

export type Task =
  | 'classify-expense'
  | 'extract-receipt'
  | 'extract-holdings'
  | 'insights'
  | 'resolve-transfer';

export type ImageInput = {
  /** e.g. 'image/jpeg', 'image/png', 'image/webp' */
  mediaType: string;
  /** Base64, no data: prefix, no newlines. */
  base64: string;
};

export type DocumentInput = {
  mediaType: 'application/pdf';
  base64: string;
};

export interface CompletionRequest<T> {
  task: Task;
  /** Required — the response is validated against this before it reaches the caller. */
  schema: z.ZodType<T>;
  /** Short label used as the schema name in the request and in logs. */
  schemaName: string;
  system?: string;
  prompt: string;
  images?: ImageInput[];
  documents?: DocumentInput[];
  /**
   * Stable text placed ahead of `prompt` behind a cache breakpoint. Only used when the
   * chosen model supports caching and the block is likely to clear its minimum size.
   */
  cachePrefix?: string;
  /** Overrides the per-task default. */
  maxTokens?: number;
  /** Milliseconds. Overrides the per-task default. */
  timeoutMs?: number;
}

export type ErrorKind =
  /** No credentials configured — the feature should present as unavailable, not broken. */
  | 'not_configured'
  /**
   * Credentials present but unusable: bad/revoked key, or no API credit on the account.
   * Distinct from 'transport' because it will not fix itself — someone has to act. Note a
   * Claude.ai Pro/Max subscription does not include API credit; that is billed separately.
   */
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  /** The model declined the request. */
  | 'refusal'
  /** Reply did not satisfy the schema, or was truncated. */
  | 'invalid_output'
  /** Network/transport failure, or any non-2xx that isn't a rate limit. */
  | 'transport';

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** Provider-specific model identifier that actually served the request. */
  model: string;
};

export type Result<T> =
  | { ok: true; data: T; usage: Usage }
  | { ok: false; error: { kind: ErrorKind; message: string } };

export interface LLMProvider {
  /** Stable identifier, e.g. 'anthropic'. Recorded alongside cached output. */
  readonly name: string;
  /** False when credentials are absent — lets callers hide AI affordances entirely. */
  isConfigured(): boolean;
  complete<T>(request: CompletionRequest<T>): Promise<Result<T>>;
}
