/**
 * Entry point for AI capabilities. Import from here, never from './anthropic'.
 *
 * Adding a provider: implement LLMProvider in a new file and add a case below. No caller
 * changes, because nothing outside lib/ai/ knows which provider is in use.
 */
import { AnthropicProvider } from './anthropic';
import type { LLMProvider } from './provider';

export * from './provider';
export { TASKS, MODELS } from './models';

let cached: LLMProvider | null = null;

export function getProvider(): LLMProvider {
  if (!cached) {
    const name = (process.env.AI_PROVIDER ?? 'anthropic').toLowerCase();
    switch (name) {
      case 'anthropic':
        cached = new AnthropicProvider();
        break;
      default:
        // Unknown provider is a configuration error, not a crash: fall back to the default
        // so the app still boots, and the features degrade as if no key were present.
        console.warn(`[ai] Unknown AI_PROVIDER '${name}', falling back to anthropic`);
        cached = new AnthropicProvider();
    }
  }
  return cached;
}

/**
 * Whether AI features should be offered in the UI at all. When false, callers should hide
 * the affordance rather than show a button that always fails.
 */
export function isAIEnabled(): boolean {
  return getProvider().isConfigured();
}
