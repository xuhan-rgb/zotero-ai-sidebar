import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Window } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  dispatchPreferenceChange,
  formatPreferenceSaveSections,
  hasUnsavedPresetChanges,
  resolveTestModel,
  setPreferenceSaveBarVisible,
} from "../../src/modules/preferences";

const originalEvent = globalThis.Event;
const preferenceMarkup = readFileSync(
  resolve(process.cwd(), "addon/content/preferences.xhtml"),
  "utf8",
);

afterEach(() => {
  Object.defineProperty(globalThis, "Event", {
    configurable: true,
    value: originalEvent,
    writable: true,
  });
});

describe("dispatchPreferenceChange", () => {
  it("uses the preference window Event constructor in the Zotero sandbox", () => {
    const preferenceWindow = new Window();
    const preferenceDocument = preferenceWindow.document as unknown as Document;
    Object.defineProperty(globalThis, "Event", {
      configurable: true,
      value: undefined,
      writable: true,
    });
    const target = preferenceDocument.createElement("div");
    const listener = vi.fn();
    target.addEventListener("change", listener);

    dispatchPreferenceChange(preferenceDocument, target);

    expect(listener).toHaveBeenCalledOnce();
  });
});

describe("resolveTestModel", () => {
  it("defaults to the first configured model", () => {
    expect(resolveTestModel(["gpt-5.6-sol", "gpt-5.6-luna"], "")).toBe(
      "gpt-5.6-sol",
    );
  });

  it("keeps a selected model while it remains configured", () => {
    expect(
      resolveTestModel(["gpt-5.6-sol", "gpt-5.6-luna"], "gpt-5.6-luna"),
    ).toBe("gpt-5.6-luna");
  });

  it("falls back to the first model after the selected model is removed", () => {
    expect(resolveTestModel(["gpt-5.6-terra"], "gpt-5.6-luna")).toBe(
      "gpt-5.6-terra",
    );
  });
});

describe("formatPreferenceSaveSections", () => {
  it("formats dirty sections in their page order", () => {
    expect(formatPreferenceSaveSections(["sync", "presets", "mcp"])).toBe(
      "账号与模型、MCP Servers、WebDAV 账号",
    );
  });

  it("deduplicates dirty section labels", () => {
    expect(formatPreferenceSaveSections(["prompts", "prompts"])).toBe(
      "快捷提示词",
    );
  });
});

describe("hasUnsavedPresetChanges", () => {
  it("treats a newly added empty preset card as an unsaved change", () => {
    const saved = [
      {
        id: "saved",
        provider: "openai" as const,
        label: "GPT",
        apiKey: "sk-test",
        baseUrl: "",
        model: "gpt-5.6-sol",
        models: ["gpt-5.6-sol"],
        maxTokens: 8192,
      },
    ];
    const empty = {
      id: "new",
      provider: "openai" as const,
      label: "GPT",
      apiKey: "",
      baseUrl: "",
      model: "",
      models: [],
      maxTokens: 8192,
    };

    expect(hasUnsavedPresetChanges([...saved, empty], saved)).toBe(true);
  });
});

describe("setPreferenceSaveBarVisible", () => {
  it("uses explicit hidden attributes for Zotero XHTML compatibility", () => {
    const bar = {
      removeAttribute: vi.fn(),
      setAttribute: vi.fn(),
    } as unknown as HTMLElement;

    setPreferenceSaveBarVisible(bar, true);
    expect(bar.removeAttribute).toHaveBeenCalledWith("hidden");

    setPreferenceSaveBarVisible(bar, false);
    expect(bar.setAttribute).toHaveBeenCalledWith("hidden", "hidden");
  });
});

describe("preference save controls", () => {
  it("uses one contextual save bar instead of section save buttons", () => {
    expect(preferenceMarkup).toContain('id="zai-save-bar"');
    expect(preferenceMarkup).toContain('id="zai-save-commit"');
    for (const obsoleteID of [
      "zai-preset-save",
      "zai-translate-save",
      "zai-color-save",
      "zai-text-annotation-font-save",
      "zai-ui-save",
      "zai-prompt-save",
      "zai-tool-save",
      "zai-sync-save",
    ]) {
      expect(preferenceMarkup).not.toContain(`id="${obsoleteID}"`);
    }
  });

  it("keeps the contextual save bar visible above editable sections", () => {
    expect(preferenceMarkup.indexOf('id="zai-save-bar"')).toBeLessThan(
      preferenceMarkup.indexOf('data-save-section="presets"'),
    );
    expect(preferenceMarkup).toMatch(
      /\.zai-save-bar\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*8px;/,
    );
  });

  it("marks only compound settings as explicitly saved sections", () => {
    const sections = Array.from(
      preferenceMarkup.matchAll(/data-save-section="([^"]+)"/g),
      (match) => match[1],
    );
    expect(sections).toEqual(["presets", "prompts", "mcp", "sync"]);
  });

  it("does not duplicate preference control IDs", () => {
    const ids = Array.from(
      preferenceMarkup.matchAll(/\sid="([^"]+)"/g),
      (match) => match[1],
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers classic embedded defaults with optional compact and docked layouts", () => {
    expect(preferenceMarkup).toContain('id="zai-ui-chat-layout"');
    expect(preferenceMarkup).toContain(
      '<html:option value="classic">原始排版（默认）</html:option>',
    );
    expect(preferenceMarkup).toContain('value="compact">专注模式');
    expect(preferenceMarkup).toContain('id="zai-ui-sidebar-display"');
    expect(preferenceMarkup).toContain(
      '<html:option value="embedded">阅读器侧栏（默认）</html:option>',
    );
    expect(preferenceMarkup).toContain('value="docked">右侧并排（同一主窗口）');
    expect(preferenceMarkup).not.toContain('value="companion"');
  });

  it("uses a flat account picker instead of an account select", () => {
    expect(preferenceMarkup).toContain('id="zai-preset-picker"');
    expect(preferenceMarkup).toContain('role="listbox"');
    expect(preferenceMarkup).not.toContain('id="zai-preset-select"');
  });

  it("groups settings in their editing workflow order", () => {
    const sectionTitles = Array.from(
      preferenceMarkup.matchAll(
        /<html:div class="zai-page-section-title">([^<]+)<\/html:div>/g,
      ),
      (match) => match[1],
    );
    expect(sectionTitles).toEqual([
      "常用设置",
      "PDF 工具",
      "扩展能力",
      "数据管理",
    ]);

    const positions = [
      ">账号与模型</html:div>",
      ">沉浸阅读</html:div>",
      ">快捷提示词</html:div>",
      ">显示设置</html:div>",
      ">PDF 工具</html:div>",
      ">联网与 MCP</html:div>",
      ">云同步（WebDAV）</html:div>",
      ">配置备份</html:div>",
    ].map((marker) => preferenceMarkup.indexOf(marker));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("keeps PDF tools in one compact card", () => {
    const pdfTools = preferenceMarkup.slice(
      preferenceMarkup.indexOf(">PDF 工具</html:div>"),
      preferenceMarkup.indexOf(">扩展能力</html:div>"),
    );

    expect(pdfTools).toContain('id="zai-tool-annotation-color-guide"');
    expect(pdfTools).toContain('class="zai-color-guide"');
    expect(pdfTools).toContain('id="zai-tool-text-annotation-font-size"');
    expect(pdfTools).toContain('class="zai-number-input"');
    expect(pdfTools).toContain("恢复默认颜色预设");
    expect(pdfTools).not.toContain("PDF 注释颜色预设");
    expect(pdfTools).not.toContain("PDF 新增文字（T 工具）");
  });

  it("keeps numeric settings compact", () => {
    expect(preferenceMarkup).toMatch(
      /input\[type="number"\]\.zai-number-input\s*\{[^}]*width:\s*140px/,
    );
  });

  it("uses secondary headings for nested editors", () => {
    expect(preferenceMarkup).toMatch(
      /<html:div class="zai-pref-subtitle zai-card-section"\s*>\s*自定义按钮\s*<\/html:div\s*>/,
    );
    expect(preferenceMarkup).toMatch(
      /<html:div class="zai-pref-subtitle zai-card-section"\s*>\s*MCP Servers\s*<\/html:div\s*>/,
    );
  });

  it("shows editable Nutstore defaults and an official setup guide", () => {
    const urlInput = preferenceMarkup.match(
      /<html:input\s+id="zai-sync-url"[\s\S]*?\/>/,
    )?.[0];
    const folderInput = preferenceMarkup.match(
      /<html:input\s+id="zai-sync-folder"[\s\S]*?\/>/,
    )?.[0];

    expect(urlInput).toContain('value="https://dav.jianguoyun.com/dav/"');
    expect(folderInput).toContain('value="zotero-ai-sidebar"');
    expect(urlInput).not.toMatch(/\b(readonly|disabled)\b/);
    expect(folderInput).not.toMatch(/\b(readonly|disabled)\b/);
    expect(preferenceMarkup).not.toContain("zai-default-tag");
    expect(preferenceMarkup).toContain("如何获取坚果云邮箱和应用密码？");
    expect(preferenceMarkup).toContain("第三方应用管理");
    expect(preferenceMarkup).toContain(
      'href="https://help.jianguoyun.com/?p=2064"',
    );
  });

  it("orders WebDAV controls around the setup workflow", () => {
    const syncCard = preferenceMarkup.slice(
      preferenceMarkup.indexOf('data-save-section="sync"'),
    );
    const positions = [
      'id="zai-sync-url"',
      'id="zai-sync-username"',
      'id="zai-sync-password"',
      'class="zai-sync-guide"',
      'id="zai-sync-folder"',
      'id="zai-sync-test"',
      'id="zai-sync-auto"',
    ].map((marker) => syncCard.indexOf(marker));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("keeps common immersive controls visible and groups shortcut edits", () => {
    expect(preferenceMarkup).toContain(">沉浸阅读</html:div>");
    expect(preferenceMarkup).toContain("默认翻译模型");
    expect(preferenceMarkup).toContain("全文翻译首次使用时从这里继承");
    expect(preferenceMarkup).toContain("Quick Ask 临时问答");
    expect(preferenceMarkup).toContain("窗口内可选择账号、模型和思考强度");
    expect(preferenceMarkup).toContain("单击直接打开翻译卡");
    expect(preferenceMarkup).toContain("翻译时结合上下句");
    expect(preferenceMarkup).toContain("快捷键（5 项）");
    for (const id of [
      "zai-translate-preset",
      "zai-translate-model",
      "zai-translate-thinking",
      "zai-translate-position",
      "zai-translate-size",
      "zai-immersive-next-key",
      "zai-immersive-prev-key",
      "zai-immersive-quick-key",
      "zai-immersive-focus-ask-key",
      "zai-immersive-toggle-key",
      "zai-quick-ask-key",
    ]) {
      expect(preferenceMarkup).toContain(`id="${id}"`);
    }
  });

  it("keeps the standalone translation settings hidden for compatibility", () => {
    for (const obsoleteLabel of [
      "逐句翻译设置",
      "仅译",
      "“译”模式",
      "问 AI / 译",
    ]) {
      expect(preferenceMarkup).not.toContain(obsoleteLabel);
    }

    const legacyControls = preferenceMarkup.match(
      /<html:div\s+class="zai-legacy-translate-settings"[\s\S]*?<\/html:div>/,
    )?.[0];
    expect(legacyControls).toContain('hidden="hidden"');
    for (const id of [
      "zai-translate-context",
      "zai-translate-trigger",
      "zai-translate-next-key",
      "zai-translate-prev-key",
    ]) {
      expect(legacyControls).toContain(`id="${id}"`);
    }
  });
});
