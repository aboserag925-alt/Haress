# Public API discovery, Haress

This document describes existing read-only server routes, not a promise that the deployed backend is configured or healthy. A 503 is a failure, never a successful empty result. The current Worker rejects API requests when its backend URL is absent or unsafe. No configuration, credential or authorization change is introduced by this documentation.

## GET /api/health

Returns a JSON object with `ok: true` from the Node backend when reachable. This is a basic process health check, not proof all integrations work.

## GET /api/library

Returns `{ "items": [...] }` for approved library materials. Backend failures return an error. Do not treat an unavailable library as empty.

The machine-readable description is at /openapi.json. The RFC 9727 discovery catalog is at /.well-known/api-catalog. Only these existing public read routes are described. Private/admin APIs, account data, authentication tokens and write operations are deliberately excluded. No MCP server, OAuth issuer or payment service is advertised. No permission to train models or bypass access controls is granted here.
