import { readFileSync } from "node:fs";
import ts from "typescript";
import { Window } from "happy-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as state from "../../src/sync/state";
import * as storage from "../../src/settings/storage";
import * as ui from "../../src/settings/ui-settings";
import * as localUi from "../../src/settings/local-ui-settings";
import * as prompts from "../../src/settings/quick-prompts";
import * as tools from "../../src/settings/tool-settings";
import * as translation from "../../src/translate/settings";
import * as mineru from "../../src/settings/mineru";
import {
  loadChatConversations,
  saveChatConversations,
} from "../../src/settings/chat-history";
import {
  getCachedTranslation,
  setCachedTranslation,
} from "../../src/translate/cache";

const source = readFileSync("src/hooks.ts", "utf8");
const js = ts.transpileModule(
  source.slice(
    source.indexOf("interface ConfigBackup"),
    source.indexOf("async function pickConfigBackupFile("),
  ) +
    source.slice(
      source.indexOf("function parseConfigBackup("),
      source.indexOf("function renderPresetSettings("),
    ),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;
let files: Map<string, string>;
let values: Map<string, any>;
let prefs: storage.PrefsStore;
let backup: any;
let doc: Document;
let busy: boolean;
let status: ReturnType<typeof vi.fn>;
let refresh: ReturnType<typeof vi.fn>;

beforeEach(() => {
  files = new Map();
  values = new Map();
  busy = false;
  prefs = {
    get: (key) => values.get(key),
    set: (key, value) => {
      values.set(key, value);
    },
  };
  prompts.resetQuickPromptSettingsCache();
  vi.stubGlobal("Zotero", {
    DataDirectory: { dir: "/tmp/local-backup-data" },
    Profile: { dir: "/tmp/local-backup-profile" },
    File: {
      getContentsAsync: async (path: string) => {
        if (!files.has(path)) throw new Error("missing file");
        return files.get(path);
      },
      putContentsAsync: async (path: string, body: string) => {
        files.set(path, body);
      },
    },
    Items: {
      get: (id: number) => ({ id, key: "PAPER001", libraryID: 1 }),
      getByLibraryAndKey: (_library: number, key: string) =>
        key === "PAPER001" ? { id: 42, key, libraryID: 1 } : false,
      getAll: () => [],
      getAsync: async () => null,
    },
    Libraries: {
      get: () => ({ libraryType: "user", id: 1 }),
      userLibraryID: 1,
    },
    Groups: { get: () => false, getAll: () => [] },
    Annotations: { saveFromJSON: async () => ({ id: 0, key: "" }) },
  });
  const win = new Window();
  win.document.body.innerHTML = '<textarea id="zai-config-json"></textarea>';
  win.confirm = () => true;
  doc = win.document as unknown as Document;
  status = vi.fn();
  refresh = vi.fn();
  const deps = {
    ...state,
    ...storage,
    ...ui,
    ...localUi,
    ...prompts,
    ...tools,
    ...translation,
    ...mineru,
    zoteroPrefs: () => prefs,
    uiText: (zh: string) => zh,
    isRecord: (value: unknown) =>
      !!value && typeof value === "object" && !Array.isArray(value),
    hasOwn: (value: object, key: string) =>
      Object.prototype.hasOwnProperty.call(value, key),
    hasRunningSidebarTasks: () => busy,
    reloadSidebarConversations: refresh,
    pickConfigBackupFile: async () => "/backup.json",
    setStatus: status,
    fileErrorMessage: (prefix: string, err: Error) =>
      `${prefix}: ${err.message}`,
    byID: (d: Document, id: string) => d.getElementById(id),
    flashButton: vi.fn(),
    writeTextToClipboard: vi.fn(),
    ...Object.fromEntries(
      [
        "renderPresetSettings",
        "renderTranslateSettings",
        "renderUiSettings",
        "renderPromptSettings",
        "renderToolSettings",
        "refreshAllPreferenceDirtySections",
        "refreshSidebarPreferences",
      ].map((name) => [name, vi.fn()]),
    ),
  };
  backup = new Function(
    ...Object.keys(deps),
    `${js}; return { build: buildConfigBackup, parse: parseConfigBackup, exportFile: exportConfigBackupFile, importFile: importConfigBackupFile, restore: importConfigBackupRaw, generate: generateConfigBackupJson, copy: copyConfigBackupJson };`,
  )(...Object.values(deps));
});

async function seed() {
  storage.savePresets(prefs, [
    {
      id: "test",
      label: "Test",
      provider: "openai",
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "test-model",
      maxTokens: 1024,
    },
  ]);
  mineru.saveMineruSettings(prefs, { token: "mineru-test" });
  localUi.saveLocalUiSettings(prefs, {
    ...localUi.DEFAULT_LOCAL_UI_SETTINGS,
    chatFontSizePx: 19,
  });
  await saveChatConversations(42, {
    activeConversationID: "second",
    conversations: ["first", "second"].map((id) => ({
      id,
      title: id,
      createdAt: "2026-10-24T00:00:00Z",
      updatedAt: "2026-10-24T00:00:00Z",
      draftText: `draft-${id}`,
      historyMode: "all" as const,
      messages: [
        {
          role: "user" as const,
          content: `question-${id}`,
          images: [
            {
              id: `img-${id}`,
              name: "figure.png",
              mediaType: "image/png",
              size: 1,
              dataUrl: "data:image/png;base64,AA==",
            },
          ],
        },
        { role: "assistant" as const, content: `answer-${id}` },
      ],
    })),
  });
  await setCachedTranslation("cache-key", {
    text: "翻译",
    model: "test-model",
    createdAt: 100,
  });
}

describe("local settings and conversation backup", () => {
  it("exports and restores multiple conversations, drafts, images, caches, and settings", async () => {
    await seed();
    await backup.exportFile(doc);
    const raw = files.get("/backup.json")!;
    const exported = JSON.parse(raw);
    expect(exported.threads).toHaveLength(2);
    expect(exported.threads[1].draftText).toBe("draft-second");
    expect(exported.threads[0].messages[0].images[0].dataUrl).toContain(
      "base64",
    );
    expect(exported.translateCache.entries["cache-key"].text).toBe("翻译");
    files.clear();
    values.clear();
    files.set("/backup.json", raw);
    await backup.importFile(doc);
    const workspace = await loadChatConversations(42);
    expect(workspace.conversations).toHaveLength(2);
    expect(workspace.activeConversationID).toBe("second");
    expect(workspace.conversations[1].draftText).toBe("draft-second");
    expect(
      workspace.conversations[0].messages[0].images?.[0].dataUrl,
    ).toContain("base64");
    expect(workspace.conversations[1].messages[1].content).toBe(
      "answer-second",
    );
    expect((await getCachedTranslation("cache-key"))?.text).toBe("翻译");
    expect(storage.loadPresets(prefs)[0].apiKey).toBe("test-key");
    expect(mineru.loadMineruSettings(prefs).token).toBe("mineru-test");
    expect(localUi.loadLocalUiSettings(prefs).chatFontSizePx).toBe(19);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps other conversations and does not duplicate messages on repeated import", async () => {
    await seed();
    const raw = JSON.stringify(await backup.build());
    await saveChatConversations(42, {
      activeConversationID: "other",
      conversations: [
        {
          id: "other",
          title: "Other",
          createdAt: "2026-10-25T00:00:00Z",
          updatedAt: "2026-10-25T00:00:00Z",
          draftText: "",
          historyMode: "all",
          messages: [{ role: "user", content: "keep me" }],
        },
      ],
    });
    await backup.restore(doc, raw, "test");
    await backup.restore(doc, raw, "test");
    const workspace = await loadChatConversations(42);
    expect(workspace.conversations).toHaveLength(3);
    expect(
      workspace.conversations.find((c) => c.id === "other")?.messages[0]
        .content,
    ).toBe("keep me");
    expect(
      workspace.conversations.find((c) => c.id === "first")?.messages,
    ).toHaveLength(2);
  });

  it("accepts legacy settings-only backups without changing conversations", async () => {
    await seed();
    const before = await loadChatConversations(42);
    await backup.restore(
      doc,
      JSON.stringify({
        schema: "zotero-ai-sidebar.config.v1",
        mineruSettings: { token: "legacy" },
      }),
      "legacy",
    );
    expect(mineru.loadMineruSettings(prefs).token).toBe("legacy");
    expect(await loadChatConversations(42)).toEqual(before);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("blocks restoration during active responses and rejects unknown conversation schemas", async () => {
    await seed();
    const exported = await backup.build();
    busy = true;
    await expect(
      backup.restore(doc, JSON.stringify(exported), "test"),
    ).rejects.toThrow("请先停止");
    expect(
      backup.parse(JSON.stringify({ ...exported, schema: "future" })),
    ).toContain("不支持此对话备份格式");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reloads restored history only into idle panels and detects active responses", async () => {
    const sidebarSource = readFileSync("src/modules/sidebar.ts", "utf8");
    const helpers = ts.transpileModule(
      sidebarSource.slice(
        sidebarSource.indexOf("export function hasRunningSidebarTasks("),
        sidebarSource.indexOf("/** Return the active AI-dialog account"),
      ),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
        },
      },
    ).outputText;
    const idle = { sending: false, historyLoaded: true };
    const active = { sending: true, historyLoaded: true };
    const idleMount = {},
      activeMount = {};
    const idleWin = {},
      activeWin = {};
    const load = vi.fn();
    const controls = new Function(
      "exports",
      "mountedWindows",
      "windowSidebars",
      "states",
      "loadPersistedMessages",
      `${helpers}; return { busy: hasRunningSidebarTasks, reload: reloadSidebarConversations };`,
    )(
      {},
      new Set([idleWin, activeWin]),
      new Map([
        [idleWin, { mount: idleMount }],
        [activeWin, { mount: activeMount }],
      ]),
      new Map([
        [idleMount, idle],
        [activeMount, active],
      ]),
      load,
    );
    expect(controls.busy()).toBe(true);
    await controls.reload();
    expect(idle.historyLoaded).toBe(false);
    expect(active.historyLoaded).toBe(true);
    expect(load).toHaveBeenCalledExactlyOnceWith(idleMount, idle);
    active.sending = false;
    expect(controls.busy()).toBe(false);
  });

  it("manual JSON generation waits for conversation data", async () => {
    await seed();
    await backup.generate(doc);
    const area = doc.getElementById("zai-config-json") as HTMLTextAreaElement;
    expect(JSON.parse(area.value).threads).toHaveLength(2);
    expect(status.mock.calls.at(-1)?.[2]).toContain("AI 对话 2 个");
  });
});
