async function setBrowserWindowState(page, windowState) {
  let session;
  try {
    session = await page.context().newCDPSession(page);
    const { windowId } = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState },
    });
    return true;
  } catch (error) {
    console.warn(
      `[web-agent] could not set browser window to ${windowState}: ${String(error?.message || error)}`,
    );
    return false;
  } finally {
    await session?.detach().catch(() => undefined);
  }
}

export async function hideBrowserWindow(page) {
  return setBrowserWindowState(page, "minimized");
}

export async function showBrowserWindow(page) {
  const restored = await setBrowserWindowState(page, "normal");
  const focused = await page
    .bringToFront()
    .then(() => true)
    .catch(() => false);
  return restored && focused;
}
