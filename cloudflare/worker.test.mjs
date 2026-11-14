import test from "node:test";
import assert from "node:assert/strict";
import worker, { proxyApi } from "./worker.mjs";

test("proxies API method, path, query, headers and body to HTTPS backend", async () => {
  let captured;
  const request = new Request("https://hares.example/api/questions?source=web", {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "test-1" },
    body: JSON.stringify({ question: "ما معنى السنة؟" })
  });
  const response = await proxyApi(request, { AHL_API_BASE_URL: "https://api.example.com" }, async forwarded => {
    captured = forwarded;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  assert.equal(response.status, 200);
  assert.equal(captured.url, "https://api.example.com/api/questions?source=web");
  assert.equal(captured.method, "POST");
  assert.equal(captured.headers.get("x-request-id"), "test-1");
  assert.deepEqual(await captured.json(), { question: "ما معنى السنة؟" });
});

test("returns a clear unavailable response when backend is not configured", async () => {
  const response = await proxyApi(new Request("https://hares.example/api/health"), {});
  assert.equal(response.status, 503);
  assert.match(await response.text(), /AHL_API_BASE_URL/);
});

test("rejects non-HTTPS or path-based backend origins", async () => {
  for (const value of ["http://api.example.com", "https://api.example.com/v1", "not-a-url"]) {
    const response = await proxyApi(new Request("https://hares.example/api/health"), {
      AHL_API_BASE_URL: value
    }, async () => {
      throw new Error("fetch must not be called for an invalid origin");
    });
    assert.equal(response.status, 503);
  }
});

test("returns 502 when the configured backend cannot be reached", async () => {
  const response = await proxyApi(new Request("https://hares.example/api/health"), {
    AHL_API_BASE_URL: "https://api.example.com"
  }, async () => { throw new Error("network failure"); });
  assert.equal(response.status, 502);
});

test("passes non-API requests to the static assets binding", async () => {
  const request = new Request("https://hares.example/app/");
  const response = await worker.fetch(request, {
    ASSETS: { fetch: async received => new Response(new URL(received.url).pathname) }
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "/app/");
});
