import { describe, expect, it } from 'vitest';
import {
  parseAlignedPairs,
  parseBreakdownMarkup,
  parseTranslationWithPairs,
  stripBreakdownMarkup,
} from '../../src/translate/asker';

describe('parseTranslationWithPairs', () => {
  it('splits translation and 词对 pairs', () => {
    const raw =
      '译文：然而机器人在真实世界遇到的情境如此多样。\n' +
      '词对：scale=规模 | recipes=训练配方 | generalize=泛化';
    const out = parseTranslationWithPairs(raw);
    expect(out.translation).toBe('然而机器人在真实世界遇到的情境如此多样。');
    expect(out.pairs).toEqual([
      { en: 'scale', zh: '规模' },
      { en: 'recipes', zh: '训练配方' },
      { en: 'generalize', zh: '泛化' },
    ]);
  });

  it('returns translation with no pairs when 词对 marker is absent', () => {
    const out = parseTranslationWithPairs('译文：只是一句普通翻译。');
    expect(out.translation).toBe('只是一句普通翻译。');
    expect(out.pairs).toEqual([]);
  });

  it('treats a still-streaming buffer (no marker yet) as all translation', () => {
    const out = parseTranslationWithPairs('译文：翻译进行中');
    expect(out.translation).toBe('翻译进行中');
    expect(out.pairs).toEqual([]);
  });

  it('drops a dangling partial 词对 label mid-stream', () => {
    const out = parseTranslationWithPairs('译文：完整的一句\n词');
    expect(out.translation).toBe('完整的一句');
    expect(out.pairs).toEqual([]);
  });

  it('tolerates full-width colon, pipe and equals', () => {
    const out = parseTranslationWithPairs(
      '译文：测试。\n词对：scale＝规模 ｜ model＝模型',
    );
    expect(out.translation).toBe('测试。');
    expect(out.pairs).toEqual([
      { en: 'scale', zh: '规模' },
      { en: 'model', zh: '模型' },
    ]);
  });

  it('skips malformed pair chunks without an equals', () => {
    const out = parseTranslationWithPairs('译文：句子。\n词对：scale=规模 | broken');
    expect(out.pairs).toEqual([{ en: 'scale', zh: '规模' }]);
  });

  it('works without a 译文 label prefix', () => {
    const out = parseTranslationWithPairs('直接的译文\n词对：a=甲');
    expect(out.translation).toBe('直接的译文');
    expect(out.pairs).toEqual([{ en: 'a', zh: '甲' }]);
  });
});

describe('parseBreakdownMarkup', () => {
  it('parses subject / keyword / def tags and plain text', () => {
    const raw =
      'However, [主:the diversity of situations|情境的多样性] requires ' +
      'more than just [词:scale|规模] : [定:that can provide knowledge|能提供知识的] .';
    expect(parseBreakdownMarkup(raw)).toEqual([
      { role: 'text', en: 'However, ' },
      { role: 'subj', en: 'the diversity of situations', zh: '情境的多样性' },
      { role: 'text', en: ' requires more than just ' },
      { role: 'kw', en: 'scale', zh: '规模' },
      { role: 'text', en: ' : ' },
      { role: 'def', en: 'that can provide knowledge', zh: '能提供知识的' },
      { role: 'text', en: ' .' },
    ]);
  });

  it('drops an unterminated trailing tag while streaming', () => {
    const out = parseBreakdownMarkup('We [主:we|我们] need [词:scale');
    expect(out).toEqual([
      { role: 'text', en: 'We ' },
      { role: 'subj', en: 'we', zh: '我们' },
      { role: 'text', en: ' need ' },
    ]);
  });

  it('treats tag-less plain text as a single text segment', () => {
    expect(parseBreakdownMarkup('just plain English')).toEqual([
      { role: 'text', en: 'just plain English' },
    ]);
  });

  it('allows a tag without a Chinese gloss', () => {
    expect(parseBreakdownMarkup('[词:scale]')).toEqual([
      { role: 'kw', en: 'scale', zh: undefined },
    ]);
  });

  it('parses 谓语 (pred) and 状语 (adv) tags', () => {
    const raw =
      '[主:The results|结果] [谓:are shown|被展示] [状:in Figure 8|在图8中] .';
    expect(parseBreakdownMarkup(raw)).toEqual([
      { role: 'subj', en: 'The results', zh: '结果' },
      { role: 'text', en: ' ' },
      { role: 'pred', en: 'are shown', zh: '被展示' },
      { role: 'text', en: ' ' },
      { role: 'adv', en: 'in Figure 8', zh: '在图8中' },
      { role: 'text', en: ' .' },
    ]);
  });
});

describe('parseAlignedPairs', () => {
  it('parses 意群 lines split on |||', () => {
    const raw =
      'The results ||| 结果\n' +
      'are not significant ||| 并不显著\n' +
      'in this experiment ||| 在本实验中';
    expect(parseAlignedPairs(raw)).toEqual([
      { en: 'The results', zh: '结果' },
      { en: 'are not significant', zh: '并不显著' },
      { en: 'in this experiment', zh: '在本实验中' },
    ]);
  });

  it('skips lines without a separator and strips leading bullets/numbers', () => {
    const raw = '说明：忽略我\n- web data ||| 网络数据\n2. has impact ||| 有影响';
    expect(parseAlignedPairs(raw)).toEqual([
      { en: 'web data', zh: '网络数据' },
      { en: 'has impact', zh: '有影响' },
    ]);
  });

  it('returns empty for text with no separators', () => {
    expect(parseAlignedPairs('just a plain sentence')).toEqual([]);
  });
});

describe('stripBreakdownMarkup', () => {
  it('strips tags to plain English, bracketing def fragments', () => {
    const raw = 'However, [主:we|我们] design [定:that helps|有帮助的] now';
    expect(stripBreakdownMarkup(raw)).toBe('However, we design 〔that helps〕 now');
  });
});
