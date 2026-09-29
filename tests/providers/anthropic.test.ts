import { describe, it, expect, vi } from 'vitest';
import {
  AnthropicProvider,
  buildAnthropicThinking,
  toAnthropicMessages,
  toAnthropicSystem,
} from '../../src/providers/anthropic';
import {
  MODEL_CATALOG,
  MODEL_SUGGESTIONS,
  findClaudeDescriptor,
  type ModelPreset,
} from '../../src/settings/types';
import type { StreamChunk } from '../../src/providers/types';

vi.mock('@anthropic-ai/sdk', () => {
  const fakeStream = async function* () {
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } };
    yield {
      type: 'message_delta',
      usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 5 },
    };
  };
  class FakeAnthropic {
    messages = { stream: async () => fakeStream() };
  }
  return { default: FakeAnthropic };
});

const preset: ModelPreset = {
  id: 'a',
  label: 'Opus',
  provider: 'anthropic',
  apiKey: 'sk',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-opus-4-7-20251101',
  maxTokens: 1000,
};

describe('AnthropicProvider', () => {
  it('emits text_delta then usage from a streamed response', async () => {
    const p = new AnthropicProvider();
    const got: StreamChunk[] = [];
    for await (const c of p.stream(
      [{ role: 'user', content: 'hi' }],
      'be helpful',
      preset,
      new AbortController().signal,
    )) {
      got.push(c);
    }
    expect(got).toEqual([
      { type: 'text_delta', text: 'Hello' },
      { type: 'text_delta', text: ' world' },
      { type: 'usage', input: 10, output: 2, cacheRead: 5 },
    ]);
  });

  it('chat path: returns null when extras has no reasoningEffort (legacy preset)', () => {
    expect(buildAnthropicThinking({ ...preset, extras: { vendor: 'claude' } })).toBeNull();
    expect(buildAnthropicThinking({ ...preset, extras: undefined })).toBeNull();
  });

  it('chat path: maps reasoningEffort to thinking config (Claude default high → adaptive+high)', () => {
    expect(
      buildAnthropicThinking({
        ...preset,
        extras: { vendor: 'claude', reasoningEffort: 'high' },
      }),
    ).toEqual({
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
    });
  });

  it("chat path: reasoningEffort 'none'/'minimal' folds to no-thinking", () => {
    expect(
      buildAnthropicThinking({
        ...preset,
        extras: { vendor: 'claude', reasoningEffort: 'none' },
      }),
    ).toBeNull();
    expect(
      buildAnthropicThinking({
        ...preset,
        extras: { vendor: 'claude', reasoningEffort: 'minimal' },
      }),
    ).toBeNull();
  });

  it('chat path: translateThinking takes precedence over reasoningEffort', () => {
    // Contrasting values prove the branch: reasoningEffort='high' alone
    // would yield adaptive thinking, but translateThinking='off' must win
    // and produce no thinking field at all.
    expect(
      buildAnthropicThinking({
        ...preset,
        extras: {
          vendor: 'claude',
          reasoningEffort: 'high',
          translateThinking: 'off',
        },
      }),
    ).toBeNull();
  });

  it('returns null thinking config when vendor is compat', () => {
    expect(
      buildAnthropicThinking({
        ...preset,
        extras: { vendor: 'compat', translateThinking: 'high' },
      }),
    ).toBeNull();
  });

  it('emits adaptive thinking + effort for Claude Opus 4.7 (xhigh stays xhigh)', () => {
    expect(
      buildAnthropicThinking({
        ...preset,
        model: 'claude-opus-4-7-20251101',
        extras: { vendor: 'claude', translateThinking: 'xhigh' },
      }),
    ).toEqual({
      thinking: { type: 'adaptive' },
      output_config: { effort: 'xhigh' },
    });
  });

  it('promotes xhigh to max for Sonnet 4.6 (Sonnet does not accept xhigh)', () => {
    expect(
      buildAnthropicThinking({
        ...preset,
        model: 'claude-sonnet-4-6',
        extras: { vendor: 'claude', translateThinking: 'xhigh' },
      }),
    ).toEqual({
      thinking: { type: 'adaptive' },
      output_config: { effort: 'max' },
    });
  });

  it('uses enabled+budget_tokens for older Claude (Haiku 4.5)', () => {
    expect(
      buildAnthropicThinking({
        ...preset,
        model: 'claude-haiku-4-5-20251001',
        extras: { vendor: 'claude', translateThinking: 'low' },
      }),
    ).toEqual({
      thinking: { type: 'enabled', budget_tokens: 1024 },
    });
  });

  it('catalog drives suggestions: MODEL_SUGGESTIONS is derived from MODEL_CATALOG', () => {
    expect(MODEL_SUGGESTIONS.claude).toEqual(MODEL_CATALOG.claude.map((m) => m.id));
    expect(MODEL_SUGGESTIONS.openai).toEqual(MODEL_CATALOG.openai.map((m) => m.id));
    expect(MODEL_SUGGESTIONS.deepseek).toEqual(MODEL_CATALOG.deepseek.map((m) => m.id));
  });

  it('findClaudeDescriptor returns exact catalog hit for known IDs', () => {
    expect(findClaudeDescriptor('claude-opus-4-7')).toMatchObject({
      thinkingDialect: 'adaptive',
      acceptsXhigh: true,
    });
    expect(findClaudeDescriptor('claude-haiku-4-5-20251001')).toMatchObject({
      thinkingDialect: 'enabled',
    });
  });

  it('findClaudeDescriptor falls back to a name-pattern heuristic for unknown IDs', () => {
    // A future Claude variant we haven't catalogued yet — heuristic places
    // it on adaptive (the modern family) and recognizes Opus 4.7 lineage.
    expect(findClaudeDescriptor('claude-opus-4-7-future-alias')).toMatchObject({
      thinkingDialect: 'adaptive',
      acceptsXhigh: true,
    });
    // Anything else falls back to enabled (older / unknown).
    expect(findClaudeDescriptor('claude-mystery-model')).toMatchObject({
      thinkingDialect: 'enabled',
    });
  });

  it("returns null for vendor=claude when level is 'off' (Claude default = no thinking)", () => {
    expect(
      buildAnthropicThinking({
        ...preset,
        extras: { vendor: 'claude', translateThinking: 'off' },
      }),
    ).toBeNull();
  });

  it("explicitly disables thinking for vendor=deepseek when level is 'off'", () => {
    // DeepSeek's default is enabled — omitting the field would still think.
    // We must send {type: 'disabled'} to actually turn it off.
    expect(
      buildAnthropicThinking({
        ...preset,
        model: 'deepseek-v4-flash',
        extras: { vendor: 'deepseek', translateThinking: 'off' },
      }),
    ).toEqual({ thinking: { type: 'disabled' } });
  });

  it("uses enabled+output_config.effort for DeepSeek-Anthropic vendor with effort collapsed to 'high'/'max'", () => {
    // medium collapses to high (DeepSeek docs note 3).
    expect(
      buildAnthropicThinking({
        ...preset,
        model: 'deepseek-v4-flash',
        extras: { vendor: 'deepseek', translateThinking: 'medium' },
      }),
    ).toEqual({
      thinking: { type: 'enabled' },
      output_config: { effort: 'high' },
    });
    // xhigh collapses to max.
    expect(
      buildAnthropicThinking({
        ...preset,
        model: 'deepseek-v4-pro',
        extras: { vendor: 'deepseek', translateThinking: 'xhigh' },
      }),
    ).toEqual({
      thinking: { type: 'enabled' },
      output_config: { effort: 'max' },
    });
  });

  it('converts screenshot attachments into Anthropic image blocks', () => {
    expect(toAnthropicMessages([
      {
        role: 'user',
        content: '分析这张图',
        images: [
          {
            id: 'img-1',
            marker: '[Image #1]',
            name: 'shot.png',
            mediaType: 'image/png',
            dataUrl: 'data:image/png;base64,abc',
            size: 3,
          },
        ],
      },
    ])).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: '分析这张图' },
          { type: 'text', text: '<image name=[Image #1]>' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'abc',
            },
          },
          { type: 'text', text: '</image>' },
        ],
      },
    ]);
  });

  it('drops assistant images when there is no preceding user turn to attach them to', () => {
    // Anthropic forbids image blocks on assistant turns. With nothing before it
    // to fold the figure into, the assistant turn replays as plain text only.
    expect(
      toAnthropicMessages([
        {
          role: 'assistant',
          content: 'Figure 3 shows the heat maps.',
          images: [
            {
              id: 'fig-3',
              name: 'figure-3.png',
              mediaType: 'image/png',
              dataUrl: 'data:image/png;base64,FIG',
              size: 3,
            },
          ],
        },
      ]),
    ).toEqual([{ role: 'assistant', content: 'Figure 3 shows the heat maps.' }]);
  });

  it('folds an assistant turn figure into the preceding user turn (keeps it visible, stays alternating)', () => {
    // A figure fetched by a tool in turn 1 lands on assistant.images. On replay
    // it must NOT ride the assistant turn (Anthropic 400 / empty stream), so it
    // is folded into the preceding user turn and the assistant turn is text only.
    expect(
      toAnthropicMessages([
        { role: 'user', content: '帮我分析一下figure3' },
        {
          role: 'assistant',
          content: 'Figure 3 shows the heat maps.',
          images: [
            {
              id: 'fig-3',
              marker: '[Figure 3]',
              name: 'figure-3.png',
              mediaType: 'image/png',
              dataUrl: 'data:image/png;base64,FIG',
              size: 3,
            },
          ],
        },
        { role: 'user', content: '再讲讲' },
      ]),
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: '帮我分析一下figure3' },
          { type: 'text', text: '[Tool-fetched figure(s), kept for visual context.]' },
          { type: 'text', text: '<image name=[Figure 3]>' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'FIG' } },
          { type: 'text', text: '</image>' },
        ],
      },
      { role: 'assistant', content: 'Figure 3 shows the heat maps.' },
      { role: 'user', content: '再讲讲' },
    ]);
  });
});

describe('toAnthropicSystem', () => {
  it('returns a single system block when no front block is given', () => {
    expect(toAnthropicSystem('SYS', undefined)).toEqual([
      { type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('appends the paper full text as a second cached block', () => {
    const blocks = toAnthropicSystem('SYS', 'PAPER BODY');
    expect(blocks).toEqual([
      { type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } },
      {
        type: 'text',
        text: '[Paper full text]\nPAPER BODY',
        cache_control: { type: 'ephemeral', ttl: '1h' },
      },
    ]);
  });

  it('treats an empty pinnedFullText as absent', () => {
    expect(toAnthropicSystem('SYS', '')).toEqual([
      { type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } },
    ]);
  });
});


describe('per-model Anthropic effort', () => {
  it.each([
    ['claude-opus-4-7', 'claude', 'max'],
    ['claude-sonnet-4-6', 'claude', 'medium'],
    ['deepseek-v4-pro', 'deepseek', 'low'],
    ['deepseek-v4-pro', 'deepseek', 'max'],
  ] as const)('%s emits the stored %s vendor effort %s', (model, vendor, effort) => {
    expect(buildAnthropicThinking({ ...preset, model, extras: {
      vendor, reasoningEffort: 'high', reasoningEffortByModel: { [model]: effort },
    } })).toMatchObject({ output_config: { effort } });
  });

  it('unknown Claude IDs use the service default instead of guessing a budget', () => {
    expect(buildAnthropicThinking({ ...preset, model: 'custom-claude', extras: {
      vendor: 'claude', reasoningEffort: 'high',
    } })).toBeNull();
  });
});
