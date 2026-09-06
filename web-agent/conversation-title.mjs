/* global document */
import { URL } from "node:url";

// Use each website's own rename controls so its authentication and history
// refresh stay in the website. Selectors follow the public frontend sources
// recorded in docs/HARNESS_ENGINEERING.md; no account tokens leave the page.
export async function renameWebConversation(page, provider, boundURL, title) {
  if (!title?.trim() || !boundURL) return false;
  const glm = provider === "chatglm";
  if (!glm && provider !== "zai") return false;
  const bound = new URL(boundURL);
  if (bound.hostname !== (glm ? "chatglm.cn" : "chat.z.ai")) return false;
  const id = glm
    ? bound.searchParams.get("cid")
    : /^\/c\/([\w-]+)$/.exec(bound.pathname)?.[1];
  if (!id) return false;
  const sameConversation = () => {
    const current = new URL(page.url());
    return (
      current.origin === bound.origin &&
      current.pathname === bound.pathname &&
      (!glm || current.searchParams.get("cid") === id)
    );
  };
  const rowSelector = glm
    ? "#aside-history-list .history-item.selected"
    : "button[data-selected='true']:has(.chatItemMenu)";
  const row = page.locator(rowSelector).filter({ visible: true });
  let editor;
  let cancel;
  try {
    if (!sameConversation() || (await row.count()) !== 1) return false;
    if (glm) {
      await row.locator(".option").click({ timeout: 1500 });
      await row
        .locator(".operate-item")
        .filter({ hasText: /^重命名$/ })
        .click({ timeout: 1500 });
      const dialog = page
        .locator(".changename_inner")
        .filter({ visible: true });
      editor = dialog.locator("textarea");
      cancel = () => dialog.locator(".cancel").click({ timeout: 500 });
    } else {
      await row.dblclick({ timeout: 1500 });
      editor = page.locator(`[id=${JSON.stringify(`chat-title-input-${id}`)}]`);
      cancel = () => editor.press("Escape", { timeout: 500 });
    }
    if (!sameConversation()) return false;
    await editor.fill(title.trim(), { timeout: 1500 });
    if (!sameConversation()) return false;
    const endpoint = glm
      ? "/chatglm/mainchat-api/conversation/modify_title"
      : `/api/v1/chats/${id}`;
    const saved = page
      .waitForResponse(
        (response) => {
          if (
            response.url() !== bound.origin + endpoint ||
            response.request().method() !== "POST"
          )
            return false;
          const body = response.request().postDataJSON();
          return glm
            ? body.conversation_id === id && body.title === title.trim()
            : body.chat?.title === title.trim();
        },
        { timeout: 2500 },
      )
      .catch(() => undefined);
    if (glm)
      await page
        .locator(".changename_inner:visible .sure")
        .click({ timeout: 1500 });
    else await editor.press("Enter", { timeout: 1500 });
    const response = await saved;
    if (!response?.ok() || (glm && (await response.json()).status !== 0))
      return false;
    await page.waitForFunction(
      ({ selector, title }) =>
        Array.from(document.querySelectorAll(selector)).some(
          (node) => node.textContent?.trim() === title,
        ),
      {
        selector: glm ? `${rowSelector} .title` : rowSelector,
        title: title.trim(),
      },
      { timeout: 2000 },
    );
    return true;
  } catch {
    return false;
  } finally {
    if (editor && (await editor.isVisible().catch(() => false)))
      await cancel?.().catch(() => undefined);
  }
}
