# Library assets (books reader)

The production Worker serves a PDF reader and 35 PDF parts that are not stored in git.

- pdf.js: `scripts/vendor-pdfjs.sh` copies pdfjs-dist 5.4.624 into `app/vendor/pdfjs/` and checks sha256 against the files live in production.
- Books: `scripts/prepare-pdf-books.py` downloads the four source PDFs listed in `content/pdf-source-manifest.json` from NYU Arabic Collections Online / Columbia University Libraries (mc.dlib.nyu.edu), verifies each by sha256, and splits them into parts under `app/books/` (needs `PyMuPDF==1.26.7`).
  It also rewrites `app/books.json`; the committed copy is the one production serves.
- Rights basis (from the manifest): NYU states it believes the materials are in the public domain and offers a takedown route. This is a belief statement, not a licence. Keep attribution and honour takedowns.

Run both before `wrangler deploy` so the deployed assets match production.
