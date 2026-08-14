import { describe, it, expect } from 'vitest';
import { splitSentences, sentenceAt } from '../../src/translate/sentence-splitter';

describe('splitSentences', () => {
  it('splits on . ? !', () => {
    const result = splitSentences('Hello world. How are you? I am fine!');
    expect(result.map((r) => r.text)).toEqual([
      'Hello world.',
      'How are you?',
      'I am fine!',
    ]);
  });

  it('splits on Chinese punctuation', () => {
    const result = splitSentences('你好。今天怎么样？很好！');
    expect(result.map((r) => r.text)).toEqual(['你好。', '今天怎么样？', '很好！']);
  });

  it('does not split on common abbreviations', () => {
    const result = splitSentences('See Dr. Smith and Mr. Jones today.');
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('See Dr. Smith and Mr. Jones today.');
  });

  it('does not split on e.g. and i.e.', () => {
    const result = splitSentences('We use tools, e.g. ripgrep, for speed.');
    expect(result).toHaveLength(1);
  });

  it('does not split inside U.S.A. style acronyms', () => {
    const result = splitSentences('I live in the U.S.A. and study here.');
    expect(result).toHaveLength(1);
  });

  it('can split after an acronym at a sentence boundary', () => {
    const result = splitSentences('I live in the U.S.A. Next sentence.');
    expect(result.map((r) => r.text)).toEqual([
      'I live in the U.S.A.',
      'Next sentence.',
    ]);
  });

  it('requires whitespace after period to split', () => {
    const result = splitSentences('foo.bar. Next sentence.');
    expect(result.map((r) => r.text)).toEqual(['foo.bar.', 'Next sentence.']);
  });

  it('does not split mathematical ellipses inside a formula', () => {
    const result = splitSentences(
      '完整集合记为 A_t = {a_t^1, a_t^2, . . . , a_t^L}，其中 L 表示特征向量的数量。',
    );
    expect(result.map((r) => r.text)).toEqual([
      '完整集合记为 A_t = {a_t^1, a_t^2, . . . , a_t^L}，其中 L 表示特征向量的数量。',
    ]);
  });
});

describe('sentenceAt', () => {
  it('returns the sentence containing the offset', () => {
    const text = 'First. Second sentence here. Third!';
    const hit = sentenceAt(text, 12);
    expect(hit?.text).toBe('Second sentence here.');
    expect(hit?.start).toBe(7);
    expect(hit?.end).toBe(28);
  });

  it('returns null on out-of-range offset', () => {
    expect(sentenceAt('hi.', 99)).toBeNull();
  });
});
