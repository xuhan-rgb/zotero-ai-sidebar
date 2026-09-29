// End-to-end matrix test: for every supported (provider/vendor) × thinking
// level combo we run translateSentence and capture the actual request body
// handed to the SDK. This pins what we send on the wire and surfaces any
// drift between UI semantics and provider request shape.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translateSentence } from '../../src/translate/translator';
import type { ModelPreset, TranslateThinking } from '../../src/settings/types';

// ---------- mock state captured per test ----------
let openaiRequest: Record<string, unknown> | null = null;
let anthropicRequest: Record<string, unknown> | null = null;

vi.mock('openai', () => {
  class FakeOpenAI {
    responses = {
      create: async (body: Record<string, unknown>) => {
        openaiRequest = body;
        // Return a no-op async iterable. translateSentence consumes it but
        // we don't need any chunks for the matrix assertion.
        return (async function* () {})();
      },
    };
    constructor(_opts?: unknown) {}
  }
  return { default: FakeOpenAI };
});

vi.mock('@anthropic-ai/sdk', () => {
  class FakeAnthropic {
    messages = {
      stream: async (body: Record<string, unknown>) => {
        anthropicRequest = body;
        return (async function* () {})();
      },
    };
    constructor(_opts?: unknown) {}
  }
  return { default: FakeAnthropic };
});

beforeEach(() => {
  openaiRequest = null;
  anthropicRequest = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------- preset fixtures ----------
const openaiPreset: ModelPreset = {
  id: 'o', label: 'GPT', provider: 'openai',
  apiKey: 'sk', baseUrl: '', model: 'gpt-5.4-mini',
  models: ['gpt-5.4-mini'], maxTokens: 8192,
  extras: { reasoningEffort: 'high', reasoningSummary: 'concise' },
};

const claudeAdaptivePreset: ModelPreset = {
  id: 'c-a', label: 'Claude', provider: 'anthropic',
  apiKey: 'sk', baseUrl: 'https://api.anthropic.com',
  model: 'claude-opus-4-7',
  models: ['claude-opus-4-7'], maxTokens: 8192,
  extras: { vendor: 'claude' },
};

const claudeEnabledPreset: ModelPreset = {
  ...claudeAdaptivePreset,
  id: 'c-e',
  model: 'claude-haiku-4-5-20251001',
  models: ['claude-haiku-4-5-20251001'],
};

const deepseekPreset: ModelPreset = {
  id: 'ds', label: 'DeepSeek', provider: 'anthropic',
  apiKey: 'sk', baseUrl: 'https://api.deepseek.com/anthropic',
  model: 'deepseek-v4-flash',
  models: ['deepseek-v4-flash'], maxTokens: 8192,
  extras: { vendor: 'deepseek' },
};

async function runTranslate(preset: ModelPreset, level: TranslateThinking) {
  const iter = translateSentence({
    sentence: 'hello',
    preset,
    model: '',
    thinking: level,
    signal: new AbortController().signal,
  });
  // drain the iterator so the underlying provider stream fires
  for await (const _ of iter) {
    void _;
  }
}

// ---------- OpenAI (gpt-5.x reasoning models) ----------
describe('OpenAI reasoning request body', () => {
  for (const level of ['off', 'low', 'medium', 'high', 'xhigh'] as const) {
    it(`level=${level} → reasoning.effort matches expected`, async () => {
      await runTranslate(openaiPreset, level);
      const expectedEffort: Record<TranslateThinking, string> = {
        off: 'none',
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: 'xhigh',
      };
      expect((openaiRequest as { reasoning: { effort: string } }).reasoning.effort)
        .toBe(expectedEffort[level]);
      // summary forced to 'none' in translate flow → key omitted entirely
      expect((openaiRequest as { reasoning: Record<string, unknown> }).reasoning)
        .not.toHaveProperty('summary');
    });
  }
});

// ---------- Claude adaptive (Opus 4.7) ----------
describe('Claude adaptive request body (Opus 4.7)', () => {
  it("level=off → no thinking field on the request", async () => {
    await runTranslate(claudeAdaptivePreset, 'off');
    expect(anthropicRequest).not.toHaveProperty('thinking');
    expect(anthropicRequest).not.toHaveProperty('output_config');
  });

  for (const level of ['low', 'medium', 'high'] as const) {
    it(`level=${level} → adaptive + effort=${level}`, async () => {
      await runTranslate(claudeAdaptivePreset, level);
      expect(anthropicRequest).toMatchObject({
        thinking: { type: 'adaptive' },
        output_config: { effort: level },
      });
    });
  }

  it("level=xhigh on Opus 4.7 → effort='xhigh' (not promoted)", async () => {
    await runTranslate(claudeAdaptivePreset, 'xhigh');
    expect(anthropicRequest).toMatchObject({
      thinking: { type: 'adaptive' },
      output_config: { effort: 'xhigh' },
    });
  });

  it('level=xhigh on Sonnet 4.6 → effort=max (promoted, since Sonnet rejects xhigh)', async () => {
    await runTranslate(
      { ...claudeAdaptivePreset, model: 'claude-sonnet-4-6' },
      'xhigh',
    );
    expect(anthropicRequest).toMatchObject({
      thinking: { type: 'adaptive' },
      output_config: { effort: 'max' },
    });
  });
});

// ---------- Claude enabled (Haiku 4.5 — older budget_tokens dialect) ----------
describe('Claude enabled request body (Haiku 4.5)', () => {
  it('level=off → no thinking field', async () => {
    await runTranslate(claudeEnabledPreset, 'off');
    expect(anthropicRequest).not.toHaveProperty('thinking');
  });

  const expectedBudget: Record<Exclude<TranslateThinking, 'off'>, number> = {
    low: 1024,
    medium: 2048,
    high: 4096,
    xhigh: 8192,
  };
  for (const level of ['low', 'medium', 'high', 'xhigh'] as const) {
    it(`level=${level} → enabled + budget_tokens=${expectedBudget[level]}`, async () => {
      await runTranslate(claudeEnabledPreset, level);
      expect(anthropicRequest).toMatchObject({
        thinking: { type: 'enabled', budget_tokens: expectedBudget[level] },
      });
      // For enabled mode max_tokens MUST exceed budget_tokens, otherwise
      // Anthropic rejects with 400. Verify the translator pads correctly.
      const maxTokens = (anthropicRequest as { max_tokens: number }).max_tokens;
      expect(maxTokens).toBeGreaterThan(expectedBudget[level]);
    });
  }
});

// ---------- DeepSeek (Anthropic format) ----------
describe('DeepSeek request body', () => {
  it("level=off → MUST send {type:'disabled'} (DeepSeek default is enabled)", async () => {
    await runTranslate(deepseekPreset, 'off');
    expect(anthropicRequest).toMatchObject({
      thinking: { type: 'disabled' },
    });
    // No output_config when disabled — effort is meaningless then.
    expect(anthropicRequest).not.toHaveProperty('output_config');
  });

  // Current DeepSeek supports low/high/max; retain the legacy xhigh alias.
  const expectedDeepseekEffort: Record<Exclude<TranslateThinking, 'off'>, 'low' | 'high' | 'max'> = {
    low: 'low',
    medium: 'high',
    high: 'high',
    xhigh: 'max',
  };
  for (const level of ['low', 'medium', 'high', 'xhigh'] as const) {
    it(`level=${level} → enabled + output_config.effort=${expectedDeepseekEffort[level]} (pre-collapsed)`, async () => {
      await runTranslate(deepseekPreset, level);
      expect(anthropicRequest).toMatchObject({
        thinking: { type: 'enabled' },
        output_config: { effort: expectedDeepseekEffort[level] },
      });
    });
  }
});
