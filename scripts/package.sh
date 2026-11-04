#!/usr/bin/env bash
# Builds dist/triagent-extension-<version>.zip with only the files the browser loads.
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p 'require("./manifest.json").version')
out="dist/triagent-extension-$version.zip"
mkdir -p dist
rm -f "$out"
zip -q -X "$out" manifest.json background.js content.js content.css
echo "$out"
