#!/bin/bash

set -euo pipefail;

npm run build
cp ./dist/assets/index-*.js "$DEPLOY_DST_DIR"/main.js
cp ./dist/assets/index-*.css "$DEPLOY_DST_DIR"/main.css

cd "$DEPLOY_DST_DIR"
cd "$(git rev-parse --show-toplevel)"
hugo
rsync -havz public/ "$DEPLOY_RSYNC_DST"
