#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
zotero_data_dir=${1:-"${HOME}/Zotero"}
data_root=${XDG_DATA_HOME:-"${HOME}/.local/share"}
install_dir="${data_root}/zotero-ai-sidebar/web-agent"
profile_dir="${data_root}/zotero-ai-sidebar/browser-profile"
config_path="${zotero_data_dir}/zai-web-agent-config.json"
node_path=$(command -v node)
chrome_path=$(command -v google-chrome || command -v google-chrome-stable)
command -v xclip >/dev/null

mkdir -p "$install_dir"
install -m 0644 "$project_root/web-agent/package.json" "$install_dir/package.json"
install -m 0644 "$project_root/web-agent/agent.mjs" "$install_dir/agent.mjs"
install -m 0644 "$project_root/web-agent/adapters.mjs" "$install_dir/adapters.mjs"
install -m 0644 "$project_root/web-agent/attachments.mjs" "$install_dir/attachments.mjs"
install -m 0644 "$project_root/web-agent/answer-wait.mjs" "$install_dir/answer-wait.mjs"
install -m 0644 "$project_root/web-agent/window-visibility.mjs" "$install_dir/window-visibility.mjs"
install -m 0644 "$project_root/web-agent/browser-mode.mjs" "$install_dir/browser-mode.mjs"
npm install --prefix "$install_dir" --omit=dev --ignore-scripts
node "$project_root/web-agent/write-config.mjs" \
  "$config_path" "$node_path" "$chrome_path" \
  "$install_dir/agent.mjs" "$profile_dir"

printf 'Web Agent installed: %s\n' "$install_dir"
printf 'Config written: %s\n' "$config_path"
