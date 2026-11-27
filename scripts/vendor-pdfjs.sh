#!/usr/bin/env bash
# Reproduces app/vendor/pdfjs/* (used by app/books-reader.js) from the pinned npm release.
# Output is byte-identical to the files served by the production Worker (sha256 pinned below).
set -euo pipefail
VERSION=5.4.624
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
npm pack "pdfjs-dist@$VERSION" --pack-destination "$tmp" --silent >/dev/null
tar -xf "$tmp/pdfjs-dist-$VERSION.tgz" -C "$tmp"
mkdir -p app/vendor/pdfjs
cp "$tmp/package/build/pdf.mjs" "$tmp/package/build/pdf.worker.mjs" "$tmp/package/LICENSE" app/vendor/pdfjs/
cat > "$tmp/sums" <<'SUMS'
e668546e4f396e7769e141b7b0d09aed91c84e1752c7642a2fe87f335dfab84f  app/vendor/pdfjs/pdf.mjs
a6a52b63b21b901a70c28d662c72716df14ffbfc4b54436747df333add0649cb  app/vendor/pdfjs/pdf.worker.mjs
0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594  app/vendor/pdfjs/LICENSE
SUMS
sha256sum -c "$tmp/sums"
