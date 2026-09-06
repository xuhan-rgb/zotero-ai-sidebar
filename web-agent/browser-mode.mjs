export function chromeLaunchArguments(config, mode) {
  if (mode === "manual") {
    return [
      `--user-data-dir=${config.profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
    ];
  }
  return [
    `--user-data-dir=${config.profileDir}`,
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
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
