import { describe, expect, it } from 'vitest';
import {
  expandSlashCommandMessage,
  matchingSlashCommands,
  matchingSlashCommandsForSendMode,
} from '../../src/ui/slash-commands';

describe('slash commands', () => {
  it('matches commands from the typed slash token', () => {
    expect(matchingSlashCommands('/ar').map((command) => command.name)).toEqual(
      ['/arxiv-search'],
    );
  });

  it('offers slash commands in API mode but not WEB mode', () => {
    expect(
      matchingSlashCommandsForSendMode('/', 'api').map(
        (command) => command.name,
      ),
    ).toEqual(['/arxiv-search', '/web-search']);
    expect(matchingSlashCommandsForSendMode('/', 'web')).toEqual([]);
  });

  it('expands arxiv search into an explicit model instruction', () => {
    expect(expandSlashCommandMessage('/arxiv-search 1706.03762')).toContain(
      'User explicitly selected /arxiv-search.',
    );
    expect(expandSlashCommandMessage('/arxiv-search 1706.03762')).toContain(
      'Search/analyze request: 1706.03762',
    );
  });

  it('leaves normal messages unchanged', () => {
    expect(expandSlashCommandMessage('总结当前论文')).toBe('总结当前论文');
  });
});
