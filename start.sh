#!/bin/zsh
set -eu
cd "${0:A:h}"
if ! command -v node >/dev/null 2>&1; then
  if [[ -x "$HOME/.local/bin/node" ]]; then
    export PATH="$HOME/.local/bin:$PATH"
  else
    echo "需要先安装 Node.js 20 或更新版本。"
    exit 1
  fi
fi
exec node server.mjs
