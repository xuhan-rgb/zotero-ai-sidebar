import { promptText } from '../utils/prompt-locale';

export interface SlashCommand {
  name: string;
  usage: string;
  description: string;
  prompt: (args: string) => string;
}

// Explicit user shortcuts only. They do not execute local logic directly;
// they expand to a visible instruction and let the model choose the tools
// exposed in the provider request.
export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: '/arxiv-search',
    usage: '/arxiv-search <query or arXiv URL>',
    description:
      'Search arXiv or inspect an arXiv paper with available tools.',
    prompt: (args) =>
      [
        promptText(
          '用户明确选择了 /arxiv-search。',
          'User explicitly selected /arxiv-search.',
        ),
        args
          ? `${promptText('搜索/分析请求', 'Search/analyze request')}: ${args}`
          : promptText(
              '用户没有提供查询内容。如果当前 Zotero 条目的标题/摘要足够，就用它作为查询；否则询问用户要搜索什么。',
              'No query was provided. If the current Zotero item title/abstract is enough, use it as the query; otherwise ask the user what to search.',
            ),
      ].join('\n'),
  },
  {
    name: '/web-search',
    usage: '/web-search <query>',
    description: 'Search the web with the configured built-in search tool.',
    prompt: (args) =>
      [
        promptText(
          '用户明确选择了 /web-search。',
          'User explicitly selected /web-search.',
        ),
        promptText(
          '如果有可用的内置网页搜索工具，请使用它。如果没有可用工具，请说明当前未启用搜索，不要假装已经搜索。',
          'Use the configured built-in web search tool when it is available. If no web search tool is available, say that search is not enabled instead of pretending to search.',
        ),
        args
          ? `${promptText('搜索请求', 'Search request')}: ${args}`
          : promptText('用户没有提供查询内容；请询问查询内容。', 'No query was provided; ask for a query.'),
      ].join('\n'),
  },
];

export function matchingSlashCommands(token: string): SlashCommand[] {
  const normalized = token.startsWith('/') ? token : `/${token}`;
  return SLASH_COMMANDS.filter((command) =>
    command.name.startsWith(normalized),
  );
}

export function matchingSlashCommandsForSendMode(
  token: string,
  sendMode: 'api' | 'web',
): SlashCommand[] {
  return sendMode === 'web' ? [] : matchingSlashCommands(token);
}

export function expandSlashCommandMessage(content: string): string {
  const trimmedStart = content.match(/^\s*/)?.[0] ?? '';
  const rest = content.slice(trimmedStart.length);
  for (const command of SLASH_COMMANDS) {
    if (rest === command.name || rest.startsWith(`${command.name} `)) {
      return command.prompt(rest.slice(command.name.length).trim());
    }
  }
  return content;
}
