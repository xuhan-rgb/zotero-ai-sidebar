import { describe, expect, it } from 'vitest';
import {
  inferModelSuggestionGroupFromName,
  resolveModelSuggestionKey,
} from '../../src/settings/model-catalog';

describe('model suggestion catalog resolution', () => {
  it('keeps Anthropic Vendor as the source of Anthropic suggestions', () => {
    expect(
      resolveModelSuggestionKey(
        'anthropic',
        'https://api.anthropic.com',
        ['claude-sonnet-4-6'],
        'claude',
      ),
    ).toBe('claude');
    expect(
      resolveModelSuggestionKey(
        'anthropic',
        'https://api.anthropic.com',
        ['deepseek-v4-flash'],
        'deepseek',
      ),
    ).toBe('deepseek');
    expect(resolveModelSuggestionKey('anthropic', '', [], 'compat')).toBe(
      'compat',
    );
  });

  it('lets an explicit OpenAI-compatible Base URL win over model names', () => {
    expect(
      resolveModelSuggestionKey('openai', 'http://api.deepseek.com', []),
    ).toBe('deepseek');
    expect(
      resolveModelSuggestionKey('openai', 'https://api.deepseek.com/v1', [
        'gpt-5.2',
      ]),
    ).toBe('deepseek');
    expect(
      resolveModelSuggestionKey('openai', 'https://api.openai.com/v1', [
        'deepseek-v4-flash',
      ]),
    ).toBe('openai');
  });

  it('uses model families for generic relays', () => {
    expect(
      resolveModelSuggestionKey('openai', 'https://relay.example/v1', [
        'deepseek-v4-pro',
      ]),
    ).toBe('deepseek');
    expect(
      resolveModelSuggestionKey('openai', 'https://relay.example/v1', [
        'gpt-5.2',
      ]),
    ).toBe('openai');
  });

  it('does not guess for an unknown configured service', () => {
    expect(
      resolveModelSuggestionKey('openai', 'https://relay.example/v1', [
        'my-model',
      ]),
    ).toBe('custom');
  });

  it('does not guess a vendor for a blank OpenAI card', () => {
    expect(resolveModelSuggestionKey('openai', '', [])).toBe('custom');
  });

  it('uses a DeepSeek configuration name as the last-resort hint', () => {
    expect(inferModelSuggestionGroupFromName('deepseek')).toBe('deepseek');
    expect(inferModelSuggestionGroupFromName('GPT')).toBeUndefined();
  });

  it('lets an explicit model group override automatic URL/model detection', () => {
    expect(
      resolveModelSuggestionKey('openai', 'https://relay.example/v1', ['gpt-5.2'], undefined, 'deepseek'),
    ).toBe('deepseek');
  });
});
