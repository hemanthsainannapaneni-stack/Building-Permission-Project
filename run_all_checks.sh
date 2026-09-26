#!/bin/bash
set -e
echo "--- demo:verify ---"
npm run demo:verify
echo "--- typecheck ---"
npm run typecheck
echo "--- lint ---"
npm run lint
echo "--- build ---"
npm run build
