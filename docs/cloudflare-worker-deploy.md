# Cloudflare Worker deployment

This repository deploys the static site and the API Worker as one package.

## Cloudflare Git integration

Use the repository root as the build root:

- Root directory: `/`
- Build command: `npm ci && npm run build:cloudflare`
- Deploy command: `npx wrangler deploy`
- Preview deploy command: `npx wrangler deploy`
- Output directory (if the dashboard requests one): `dist`

Do not use `npx wrangler preview`. Do not set the build command to only `npm run build:app`: that builds the legacy `app/` tree but does not create the configured Worker assets directory `dist/`.

The build script creates `dist/index.html`, `dist/app/`, `dist/assets/`, and the runtime API configuration. The Worker entry point is `cloudflare/worker.mjs`; `wrangler.jsonc` routes `/api/*` through the Worker before static assets are considered.

## Runtime configuration

The Worker uses `AHL_API_BASE_URL` to forward API requests to the Node service over HTTPS. The current configured backend origin is the Railway service origin in `wrangler.jsonc`.

The Node service must allow the public Worker origin in its `ALLOWED_ORIGINS` setting. Confirm that configuration in Railway without printing or exposing any secret values. A successful static asset deployment alone does not prove that `GET /api/health` reaches the Node backend.

## Verification

After a preview deploy:

1. Open the preview root and `/app/`.
2. Request `/api/health` on that same preview host.
3. Confirm a successful response from the Node health endpoint.
4. Confirm browser requests to lectures, library, and questions use same-origin `/api/*` paths.
5. Check the Worker deployment logs for upstream errors.

The GitHub Actions workflow separately runs `npm test`, builds the same `dist/` package, uploads that tested artifact, and deploys only from `main`. A preview deployment is not a production deployment.
