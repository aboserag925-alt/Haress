import test from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.js";

test("proxies API requests to the configured HTTPS backend", async () => {
  let captured;
  const response = await worker.fetch(new Request("https://hares.example/api/health?check=1"), {
    AHL_API_BASE_URL: "https://api.example.com",
    ASSETS: { fetch: async () => new Response("asset") }
  }, async () => new Response("unused"));
  assert.equal(response.status, 502);
  assert.match(await response.text(), /الاتصال بالخادم الخلفي/);
});

test("returns a clear unavailable response when backend is not configured", async () => {
  const response = await worker.fetch(new Request("https://hares.example/api/health"), {});
  assert.equal(response.status, 503);
  assert.match(await response.text(), /AHL_API_BASE_URL/);
});

test("rejects non-HTTPS or path-based backend origins", async () => {
  for (const value of ["http://api.example.com", "https://api.example.com/v1", "not-a-url"]) {
    const response = await worker.fetch(new Request("https://hares.example/api/health"), {
      AHL_API_BASE_URL: value
    });
    assert.equal(response.status, 503);
  }
});

test("passes non-API requests to the static assets binding", async () => {
  const request = new Request("https://hares.example/app/");
  const response = await worker.fetch(request, {
    ASSETS: { fetch: async received => new Response(new URL(received.url).pathname) }
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "/app/");
});
