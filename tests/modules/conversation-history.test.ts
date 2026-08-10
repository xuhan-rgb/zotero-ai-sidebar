import { describe, expect, it } from 'vitest';

import {
  selectConversationHistory,
  type ConversationHistoryMode,
} from '../../src/modules/conversation-history';
import type { Message } from '../../src/providers/types';

const messages: Message[] = [
  { role: 'user', content: 'first question' },
  { role: 'assistant', content: 'first answer' },
  { role: 'user', content: 'second question' },
  { role: 'assistant', content: 'second answer' },
];

describe('conversation history range', () => {
  it.each<ConversationHistoryMode>(['none'])(
    'sends no prior messages for %s',
    (mode) => {
      expect(selectConversationHistory(messages, mode)).toEqual([]);
    },
  );

  it('sends only the latest user and assistant turn for previous', () => {
    expect(selectConversationHistory(messages, 'previous')).toEqual([
      { role: 'user', content: 'second question' },
      { role: 'assistant', content: 'second answer' },
    ]);
  });

  it('ignores an unfinished trailing user message for previous', () => {
    expect(
      selectConversationHistory(
        [...messages, { role: 'user', content: 'unfinished question' }],
        'previous',
      ),
    ).toEqual([
      { role: 'user', content: 'second question' },
      { role: 'assistant', content: 'second answer' },
    ]);
  });

  it('sends the complete current-conversation history for all', () => {
    expect(selectConversationHistory(messages, 'all')).toEqual(messages);
  });
});
