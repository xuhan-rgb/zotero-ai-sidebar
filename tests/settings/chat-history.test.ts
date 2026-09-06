import { beforeEach, describe, expect, it } from 'vitest';
import {
  chatHistoryPath,
  clearAffectedBranchOriginsAfterDeletion,
  createBranchedConversation,
  createChatConversation,
  loadChatConversations,
  loadChatMessages,
  saveChatConversations,
  saveChatMessages,
} from '../../src/settings/chat-history';

let stored = '{}';

beforeEach(() => {
  stored = '{}';
  Object.defineProperty(globalThis, 'Zotero', {
    configurable: true,
    value: {
      Profile: { dir: '/tmp/zotero-profile' },
      File: {
        getContentsAsync: async () => stored,
        putContentsAsync: async (_path: string, contents: string) => {
          stored = contents;
        },
      },
    },
  });
});

describe('chat history', () => {
  it('creates a new conversation with no messages or history by default', () => {
    expect(
      createChatConversation(
        'conversation-new',
        '对话 2',
        'preset-a',
        '2026-08-10T00:00:00.000Z',
      ),
    ).toEqual({
      id: 'conversation-new',
      title: '对话 2',
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
      messages: [],
      presetID: 'preset-a',
      draftText: '',
      historyMode: 'none',
    });
  });

  it('branches through the selected message with independent full context', () => {
    const source = {
      ...createChatConversation(
        'default',
        '对话 1',
        'preset-a',
        '2026-08-10T00:00:00.000Z',
      ),
      historyMode: 'all' as const,
      draftText: '不要继承这个草稿',
      messages: [
        {
          role: 'user' as const,
          content: '问题一',
          context: { selectedText: 'PDF 上下文' },
        },
        {
          role: 'assistant' as const,
          content: '回答一',
          thinking: '思考一',
          images: [
            {
              id: 'image-1',
              name: 'figure.png',
              mediaType: 'image/png',
              dataUrl: 'data:image/png;base64,abc',
              size: 3,
            },
          ],
        },
        { role: 'user' as const, content: '不应进入分支' },
      ],
    };

    const branch = createBranchedConversation(
      source,
      1,
      'conversation-branch',
      '对话 2',
      '2026-08-11T00:00:00.000Z',
    );

    expect(branch).toMatchObject({
      id: 'conversation-branch',
      title: '对话 2',
      presetID: 'preset-a',
      draftText: '',
      historyMode: 'all',
      branchOrigin: {
        sourceConversationID: 'default',
        sourceConversationTitle: '对话 1',
        messagePreview: '回答一',
      },
      messages: [
        {
          role: 'user',
          content: '问题一',
          context: { selectedText: 'PDF 上下文' },
        },
        {
          role: 'assistant',
          content: '回答一',
          thinking: '思考一',
          images: [{ id: 'image-1' }],
        },
      ],
    });
    expect(branch.messages[0]).not.toBe(source.messages[0]);
    expect(branch.messages[0].context).not.toBe(source.messages[0].context);
    expect(branch.messages[1].images).not.toBe(source.messages[1].images);
  });

  it('clears branch markers when deleting their source or an earlier tab', () => {
    const first = createChatConversation('default', '对话 1');
    const second = createChatConversation('conversation-2', '对话 2');
    const third = createChatConversation('conversation-3', '对话 3');
    const branch = {
      ...createChatConversation('conversation-4', '对话 4'),
      branchOrigin: {
        sourceConversationID: third.id,
        sourceConversationTitle: third.title,
        messagePreview: '来源消息',
      },
    };
    const conversations = [first, second, third, branch];

    clearAffectedBranchOriginsAfterDeletion(conversations, second.id);

    expect(branch.branchOrigin).toBeUndefined();
  });

  it('migrates a legacy per-item message array into the first conversation', async () => {
    stored = JSON.stringify({
      'item:42': {
        itemID: 42,
        updatedAt: '2026-08-01T00:00:00.000Z',
        messages: [
          { role: 'user', content: 'legacy question' },
          { role: 'assistant', content: 'legacy answer' },
        ],
      },
    });

    const workspace = await loadChatConversations(42);

    expect(workspace.activeConversationID).toBe('default');
    expect(workspace.conversations).toHaveLength(1);
    expect(workspace.conversations[0]).toMatchObject({
      id: 'default',
      title: '对话 1',
      messages: [
        { role: 'user', content: 'legacy question' },
        { role: 'assistant', content: 'legacy answer' },
      ],
      draftText: '',
      historyMode: 'previous',
    });
  });

  it('round trips multiple conversations with independent model and draft state', async () => {
    await saveChatConversations(42, {
      activeConversationID: 'conversation-b',
      conversations: [
        {
          id: 'conversation-a',
          title: '论文总结',
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T01:00:00.000Z',
          messages: [
            { role: 'user', content: 'summarize' },
            { role: 'assistant', content: 'summary' },
          ],
          presetID: 'preset-a',
          draftText: '继续总结',
          historyMode: 'all',
        },
        {
          id: 'conversation-b',
          title: '实验问题',
          createdAt: '2026-08-02T00:00:00.000Z',
          updatedAt: '2026-08-02T00:00:00.000Z',
          messages: [],
          presetID: 'preset-b',
          draftText: '这个表格说明什么？',
          historyMode: 'none',
          branchOrigin: {
            sourceConversationTitle: '论文总结',
            messagePreview: 'summary',
          },
        },
      ],
    });

    expect(await loadChatConversations(42)).toEqual({
      activeConversationID: 'conversation-b',
      conversations: [
        {
          id: 'conversation-a',
          title: '论文总结',
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T01:00:00.000Z',
          messages: [
            { role: 'user', content: 'summarize' },
            { role: 'assistant', content: 'summary' },
          ],
          presetID: 'preset-a',
          draftText: '继续总结',
          historyMode: 'all',
        },
        {
          id: 'conversation-b',
          title: '实验问题',
          createdAt: '2026-08-02T00:00:00.000Z',
          updatedAt: '2026-08-02T00:00:00.000Z',
          messages: [],
          presetID: 'preset-b',
          draftText: '这个表格说明什么？',
          historyMode: 'none',
          branchOrigin: {
            sourceConversationTitle: '论文总结',
            messagePreview: 'summary',
          },
        },
      ],
    });
    expect(await loadChatMessages(42)).toEqual([]);
  });

  it('preserves screenshot attachments and agent context', async () => {
    await saveChatMessages(42, [
      {
        role: 'user',
        content: '分析截图',
        images: [
          {
            id: 'img-1',
            name: 'shot.png',
            mediaType: 'image/png',
            dataUrl: 'data:image/png;base64,abc',
            size: 3,
          },
        ],
        context: {
          selectedText: 'paper text',
          toolCalls: [
            {
              name: 'zotero_get_current_item',
              status: 'completed',
              summary: '读取当前条目',
            },
          ],
        },
      },
    ]);

    expect(await loadChatMessages(42)).toEqual([
      {
        role: 'user',
        content: '分析截图',
        images: [
          {
            id: 'img-1',
            name: 'shot.png',
            mediaType: 'image/png',
            dataUrl: 'data:image/png;base64,abc',
            size: 3,
          },
        ],
        context: {
          selectedText: 'paper text',
          toolCalls: [
            {
              name: 'zotero_get_current_item',
              status: 'completed',
              summary: '读取当前条目',
            },
          ],
        },
      },
    ]);
  });

  it('preserves assistant annotation draft color', async () => {
    await saveChatMessages(42, [
      {
        role: 'assistant',
        content: '解释正文',
        annotationDraft: {
          comment: '- 核心问题',
          color: '#ff6666',
          snapshot: {
            text: 'selected sentence',
            attachmentID: 7,
            annotation: { position: { pageIndex: 0, rects: [] } },
          },
          state: { kind: 'idle' },
          textState: { kind: 'saved', annotationID: 8, savedAt: 1234 },
        },
      },
    ]);

    expect(await loadChatMessages(42)).toEqual([
      {
        role: 'assistant',
        content: '解释正文',
        annotationDraft: {
          comment: '- 核心问题',
          color: '#ff6666',
          snapshot: {
            text: 'selected sentence',
            attachmentID: 7,
            annotation: { position: { pageIndex: 0, rects: [] } },
          },
          state: { kind: 'idle' },
          textState: { kind: 'saved', annotationID: 8, savedAt: 1234 },
        },
      },
    ]);
  });

  it('preserves the abnormal webpage-content marker', async () => {
    await saveChatMessages(42, [
      {
        role: 'assistant',
        content: '网页未返回正常回答。',
        webPageNotice: true,
      },
    ]);

    expect(await loadChatMessages(42)).toEqual([
      {
        role: 'assistant',
        content: '网页未返回正常回答。',
        webPageNotice: true,
      },
    ]);
  });

  it('preserves WEB batch annotation drafts independently of API drafts', async () => {
    await saveChatMessages(42, [
      {
        role: 'assistant',
        content: 'DeepSeek 的正常回复',
        webAnnotationBatch: {
          createdAt: 1234,
          entries: [
            {
              quote: 'exact PDF sentence',
              comment: '定义：核心概念',
              color: '#2ea8e5',
              locateState: 'located',
              confidence: 1,
              pageLabel: '3',
              snapshot: {
                text: 'exact PDF sentence',
                attachmentID: 7,
                annotation: {
                  pageLabel: '3',
                  sortIndex: '00003|000001|00000',
                  position: { pageIndex: 2, rects: [[1, 2, 3, 4]] },
                },
              },
              state: { kind: 'idle' },
            },
          ],
        },
      },
    ]);

    const restored = (await loadChatMessages(42))[0];
    expect(restored).not.toHaveProperty('annotationDraft');
    expect(restored).toMatchObject({
      content: 'DeepSeek 的正常回复',
      webAnnotationBatch: {
        createdAt: 1234,
        entries: [
          {
            quote: 'exact PDF sentence',
            locateState: 'located',
            pageLabel: '3',
            state: { kind: 'idle' },
          },
        ],
      },
    });
  });

  it('preserves cross-page WEB annotation segment save states', async () => {
    const firstSnapshot = {
      text: 'first page fragment',
      attachmentID: 7,
      annotation: {
        pageLabel: '1',
        position: { pageIndex: 0, rects: [[1, 2, 3, 4]] },
      },
    };
    const secondSnapshot = {
      text: 'second page fragment',
      attachmentID: 7,
      annotation: {
        pageLabel: '2',
        position: { pageIndex: 1, rects: [[5, 6, 7, 8]] },
      },
    };
    await saveChatMessages(42, [
      {
        role: 'assistant',
        content: 'cross-page draft',
        webAnnotationBatch: {
          createdAt: 1234,
          entries: [
            {
              quote: 'full cross-page sentence',
              comment: '关键限制',
              locateState: 'located',
              confidence: 1,
              pageLabel: '1–2',
              snapshot: firstSnapshot,
              segments: [
                {
                  snapshot: firstSnapshot,
                  state: {
                    kind: 'saved',
                    annotationID: 11,
                    savedAt: 100,
                  },
                },
                {
                  snapshot: secondSnapshot,
                  state: { kind: 'failed', error: 'second page failed' },
                },
              ],
              state: { kind: 'failed', error: 'second page failed' },
            },
          ],
        },
      },
    ]);

    expect(
      (await loadChatMessages(42))[0]?.webAnnotationBatch?.entries[0]?.segments,
    ).toEqual([
      {
        snapshot: firstSnapshot,
        state: { kind: 'saved', annotationID: 11, savedAt: 100 },
      },
      {
        snapshot: secondSnapshot,
        state: { kind: 'failed', error: 'second page failed' },
      },
    ]);
  });

  it('preserves assistant token usage', async () => {
    await saveChatMessages(42, [
      {
        role: 'assistant',
        content: '回答',
        usage: { input: 1234, output: 56, cacheRead: 789 },
      },
    ]);

    expect(await loadChatMessages(42)).toEqual([
      {
        role: 'assistant',
        content: '回答',
        usage: { input: 1234, output: 56, cacheRead: 789 },
      },
    ]);
  });

  it('preserves missing cache usage as unknown', async () => {
    await saveChatMessages(42, [
      {
        role: 'assistant',
        content: '回答',
        usage: { input: 100, output: 20 },
      },
    ]);

    expect(await loadChatMessages(42)).toEqual([
      {
        role: 'assistant',
        content: '回答',
        usage: { input: 100, output: 20 },
      },
    ]);
  });

  it('preserves local task queue metadata', async () => {
    await saveChatMessages(42, [
      {
        role: 'user',
        content: '解释这句话',
        task: {
          id: 'task-1',
          kind: 'selection',
          title: '选中文字提问',
          promptPreview: 'While most robotic learning systems...',
          createdAt: 100,
          webProvider: 'custom:sorryios',
          completedAt: 200,
          viewedAt: 300,
          pdfSelection: {
            attachmentID: 7,
            selectedText: 'While most robotic learning systems...',
            pageIndex: 0,
            pageLabel: '1',
            position: { pageIndex: 0, rects: [[1, 2, 3, 4]] },
          },
        },
      },
    ]);

    expect(await loadChatMessages(42)).toEqual([
      {
        role: 'user',
        content: '解释这句话',
        task: {
          id: 'task-1',
          kind: 'selection',
          title: '选中文字提问',
          promptPreview: 'While most robotic learning systems...',
          createdAt: 100,
          webProvider: 'custom:sorryios',
          completedAt: 200,
          viewedAt: 300,
          pdfSelection: {
            attachmentID: 7,
            selectedText: 'While most robotic learning systems...',
            pageIndex: 0,
            pageLabel: '1',
            position: { pageIndex: 0, rects: [[1, 2, 3, 4]] },
          },
        },
      },
    ]);
  });

  it('migrates persisted custom Kimi tasks to the built-in provider', async () => {
    await saveChatMessages(42, [
      {
        role: 'user',
        content: 'hello',
        task: {
          id: 'web-kimi-1',
          kind: 'general',
          title: 'Kimi Web',
          promptPreview: 'hello',
          createdAt: 100,
          webProvider: 'custom:kimi-com',
        },
      },
    ]);

    expect((await loadChatMessages(42))[0].task?.webProvider).toBe('kimi');
  });

  it('preserves the distinct GLM website when restoring Web tasks', async () => {
    for (const provider of ['chatglm', 'zai'] as const) {
      await saveChatMessages(42, [
        {
          role: 'user',
          content: 'hello',
          task: {
            id: 'glm-site-test',
            kind: 'general',
            title: 'GLM Web',
            promptPreview: 'hello',
            createdAt: 100,
            webProvider: provider,
          },
        },
      ]);
      expect((await loadChatMessages(42))[0].task?.webProvider).toBe(provider);
    }
  });

  it('uses Windows separators for data-dir and old profile migration paths', async () => {
    const newPath =
      'C:\\Users\\admin\\Zotero\\zotero-ai-sidebar-chat-history.json';
    const oldPath =
      'C:\\Users\\admin\\AppData\\Roaming\\Zotero\\Zotero\\Profiles\\uerjpa0m.default\\zotero-ai-sidebar-chat-history.json';
    const reads: string[] = [];
    const writes: string[] = [];
    Object.defineProperty(globalThis, 'Zotero', {
      configurable: true,
      value: {
        DataDirectory: { dir: 'C:\\Users\\admin\\Zotero' },
        Profile: {
          dir: 'C:\\Users\\admin\\AppData\\Roaming\\Zotero\\Zotero\\Profiles\\uerjpa0m.default',
        },
        File: {
          getContentsAsync: async (path: string) => {
            reads.push(path);
            if (path === oldPath) {
              return JSON.stringify({
                'item:42': {
                  itemID: 42,
                  updatedAt: '2026-05-27T00:00:00.000Z',
                  messages: [{ role: 'user', content: 'old chat' }],
                },
              });
            }
            throw new Error(`missing file: ${path}`);
          },
          putContentsAsync: async (path: string, contents: string) => {
            writes.push(path);
            stored = contents;
          },
        },
      },
    });

    expect(chatHistoryPath()).toBe(newPath);
    expect(await loadChatMessages(42)).toEqual([
      { role: 'user', content: 'old chat' },
    ]);
    expect(reads).toEqual([newPath, oldPath]);
    expect(writes).toEqual([newPath]);
  });
});
