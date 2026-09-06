export function chromeLaunchArguments(config, mode, debugPort = 0) {
  return [
    `--user-data-dir=${config.profileDir}`,
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${debugPort}`,
    "--no-first-run",
    "--no-default-browser-check",
    ...(mode === "headless" ? ["--headless=new"] : []),
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ];
}

export function browserModeFromVersion(version) {
  const identity = `${version?.Product || ""} ${version?.["User-Agent"] || ""}`;
  return /HeadlessChrome/i.test(identity) ? "headless" : "visible";
}
