/**
 * Anthropic implementation of the LLMProvider port.
 *
 * THIS IS THE ONLY FILE THAT IMPORTS @anthropic-ai/sdk. Keep it that way — it is what makes
 * swapping providers a one-file change.
 *
 * Everything here funnels into `messages.parse()` with a JSON-schema output format, so the
 * API enforces the shape and we never hand-parse a response.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { CompletionRequest, ErrorKind, LLMProvider, Result, Usage } from './provider';
import { TASKS, buildModelParams, shouldCache } from './models';

/** Rough token estimate — only used to decide whether a cache breakpoint is worthwhile. */
const approxTokens = (text: string) => Math.ceil(text.length / 4);

type ProviderError = { kind: ErrorKind; message: string };

function classifyError(err: unknown): ProviderError {
  if (err instanceof Anthropic.RateLimitError) {
    return { kind: 'rate_limit', message: 'Rate limited by the API' };
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return { kind: 'timeout', message: 'The request timed out' };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { kind: 'transport', message: 'Could not reach the API' };
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return { kind: 'auth', message: `Anthropic rejected the credentials: ${err.message}` };
  }
  if (err instanceof Anthropic.APIError) {
    // A billing exhaustion arrives as a 400 invalid_request_error, not a 401. It is an
    // auth-class problem — it will not recover on its own — so classify it as such rather
    // than as a transient transport blip that a caller might sensibly retry.
    if (/credit balance|billing|quota/i.test(err.message)) {
      return { kind: 'auth', message: err.message };
    }
    return { kind: 'transport', message: `API error ${err.status}: ${err.message}` };
  }
  if (err instanceof Error && /abort|timeout/i.test(err.message)) {
    return { kind: 'timeout', message: 'The request timed out' };
  }
  return { kind: 'transport', message: err instanceof Error ? err.message : String(err) };
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private client: Anthropic | null;

  constructor(apiKey = process.env.ANTHROPIC_API_KEY) {
    // Construct lazily-ish: with no key we stay unconfigured rather than throwing at import
    // time, so the app boots and every feature degrades to its non-AI path.
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async complete<T>(request: CompletionRequest<T>): Promise<Result<T>> {
    if (!this.client) {
      return { ok: false, error: { kind: 'not_configured', message: 'ANTHROPIC_API_KEY is not set' } };
    }

    const cfg = TASKS[request.task];
    const params = buildModelParams(request.task);
    const timeout = request.timeoutMs ?? cfg.timeoutMs;

    // Build user content: documents and images first, then the instruction text.
    // Anthropic's guidance is to place documents before the prompt that refers to them.
    const content: Anthropic.ContentBlockParam[] = [];

    for (const doc of request.documents ?? []) {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: doc.mediaType, data: doc.base64 },
      });
    }
    for (const img of request.images ?? []) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: img.base64,
        },
      });
    }
    if (request.cachePrefix) {
      content.push({
        type: 'text',
        text: request.cachePrefix,
        // Only mark a breakpoint when the block can actually clear the model's minimum;
        // below it the marker is silently ignored and we'd just pay the write premium.
        ...(shouldCache(request.task, approxTokens(request.cachePrefix))
          ? { cache_control: { type: 'ephemeral' as const } }
          : {}),
      });
    }
    content.push({ type: 'text', text: request.prompt });

    try {
      const response = await this.client.messages.parse(
        {
          ...params,
          ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
          ...(request.system ? { system: request.system } : {}),
          messages: [{ role: 'user', content }],
          output_config: {
            ...(params.output_config ?? {}),
            // zodOutputFormat takes the schema only; request.schemaName is for our logs.
            format: zodOutputFormat(request.schema),
          },
        },
        // maxRetries matters as much as timeout here: the SDK default of 2 turns a stalled
        // endpoint into 3 x timeout of wall-clock before it gives up.
        { timeout, maxRetries: cfg.maxRetries },
      );

      // Safety classifiers can decline with HTTP 200 — check before reading content.
      if (response.stop_reason === 'refusal') {
        // Haiku 5.5 has no server-side fallback model; every caller already degrades to its
        // non-AI path on any failure, so the category is for the logs only.
        const category = response.stop_details?.category;
        return {
          ok: false,
          error: { kind: 'refusal', message: `The model declined this request${category ? ` (${category})` : ''}` },
        };
      }
      if (response.stop_reason === 'max_tokens') {
        return {
          ok: false,
          error: { kind: 'invalid_output', message: 'Response was truncated before completing' },
        };
      }

      const parsed = response.parsed_output as T | null | undefined;
      if (parsed == null) {
        return {
          ok: false,
          error: { kind: 'invalid_output', message: 'Response did not match the expected schema' },
        };
      }

      const usage: Usage = {
        inputTokens: response.usage.input_tokens ?? 0,
        outputTokens: response.usage.output_tokens ?? 0,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        model: response.model,
      };

      // One line per call, so spend is visible in the Vercel logs without a dashboard.
      console.info(
        `[ai] ${request.task} ${usage.model} in=${usage.inputTokens} out=${usage.outputTokens} cache_read=${usage.cacheReadTokens}`,
      );

      return { ok: true, data: parsed, usage };
    } catch (err) {
      return { ok: false, error: classifyError(err) };
    }
  }
}
