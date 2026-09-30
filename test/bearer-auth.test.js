const assert = require("node:assert/strict");
const test = require("node:test");

const { createBearerAuth } = require("../src/utils/middleware/bearer-auth");

const validToken = "expected-token-with-at-least-32-bytes";

function context(path, authorization = "") {
  const responseHeaders = new Map();

  return {
    path,
    status: 200,
    get(name) {
      return name.toLowerCase() === "authorization" ? authorization : "";
    },
    set(name, value) {
      responseHeaders.set(name.toLowerCase(), value);
    },
    responseHeaders,
  };
}

test("requires a configured token", () => {
  assert.throws(
    () => createBearerAuth(),
    /EXPORT_HTML_BEARER_TOKEN must be configured/
  );
});

test("rejects a weak token", () => {
  assert.throws(
    () => createBearerAuth("too-short"),
    /must be at least 32 bytes/
  );
});

test("allows health endpoints without credentials", async () => {
  const authenticate = createBearerAuth(validToken);

  for (const path of ["/", "/check-status"]) {
    const ctx = context(path);
    let called = false;

    await authenticate(ctx, async () => {
      called = true;
    });

    assert.equal(called, true);
    assert.equal(ctx.status, 200);
  }
});

test("rejects missing and invalid credentials", async () => {
  const authenticate = createBearerAuth(validToken);

  for (const authorization of ["", "Basic value", "Bearer wrong-token"]) {
    const ctx = context("/1/pdf", authorization);
    let called = false;

    await authenticate(ctx, async () => {
      called = true;
    });

    assert.equal(called, false);
    assert.equal(ctx.status, 401);
    assert.deepEqual(ctx.body, { error: "Unauthorized" });
    assert.equal(ctx.responseHeaders.get("www-authenticate"), "Bearer");
  }
});

test("allows a valid bearer token", async () => {
  const authenticate = createBearerAuth(validToken);
  const ctx = context("/1/pdf", `Bearer ${validToken}`);
  let called = false;

  await authenticate(ctx, async () => {
    called = true;
  });

  assert.equal(called, true);
  assert.equal(ctx.status, 200);
});
