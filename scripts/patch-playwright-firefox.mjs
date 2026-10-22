import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const original = `          const page = await browser._defaultContext.doCreateNewPage();
          await page.waitForInitializedOrError();`;
const replacement = `          // Zotero: adopt Firefox's startup window rather than opening another one.
          const { contexts: startupContexts } = await browser._browserSession.send("browsingContext.getTree", { maxDepth: 0 });
          for (const startup of startupContexts) {
            if (!browser._bidiPages.has(startup.context))
              browser._onBrowsingContextCreated(startup);
            const startupPage = browser._bidiPages.get(startup.context)._page;
            startupPage.frameManager.frameLifecycleEvent(startup.context, "domcontentloaded");
            startupPage.frameManager.frameLifecycleEvent(startup.context, "load");
            await startupPage.waitForInitializedOrError();
          }
          if (!browser._defaultContext.possiblyUninitializedPages().length) {
            const page = await browser._defaultContext.doCreateNewPage();
            await page.waitForInitializedOrError();
          }`;

export function patchFirefoxStartup(source) {
  if (source.includes(replacement)) return source;
  if (source.split(original).length !== 2)
    throw new Error(
      "The pinned Playwright Firefox startup code changed; review the compatibility patch before building.",
    );
  return source.replace(original, replacement);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const target =
    process.argv[2] ||
    fileURLToPath(
      new URL(
        "../web-agent/node_modules/playwright-core/lib/coreBundle.js",
        import.meta.url,
      ),
    );
  await writeFile(target, patchFirefoxStartup(await readFile(target, "utf8")));
}
