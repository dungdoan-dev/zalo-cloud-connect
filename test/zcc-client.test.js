import assert from "node:assert/strict";
import test from "node:test";
import { buildSipTarget, normalizePhone, ZccClient, ZccError } from "../src/zcc-client.js";

test("requestConsent gửi token và payload đúng định dạng", async () => {
  let captured;
  const client = new ZccClient({
    accessToken: "secret-token",
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ error: 0, message: "Success" }), { status: 200 });
    },
  });

  const result = await client.requestConsent({
    phone: "+84773543888",
    callType: "audio",
    reasonCode: 103,
  });

  assert.equal(captured.url, "https://openapi.zalo.me/v2.0/oa/call/requestconsent");
  assert.equal(captured.init.headers.access_token, "secret-token");
  assert.deepEqual(JSON.parse(captured.init.body), {
    phone: "84773543888",
    call_type: "audio",
    reason_code: 103,
  });
  assert.equal(result.error, 0);
});

test("checkConsent URL encode tham số data", async () => {
  let capturedUrl;
  const client = new ZccClient({
    accessToken: "token",
    fetchImpl: async (url) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify({ error: 0, message: "User approved the request", expired_time: 1 }),
      );
    },
  });

  await client.checkConsent({ phone: "84773543888" });
  const url = new URL(capturedUrl);
  assert.equal(url.pathname, "/v2.0/oa/call/checkconsent");
  assert.deepEqual(JSON.parse(url.searchParams.get("data")), { phone: "84773543888" });
});

test("ném ZccError khi Zalo trả mã lỗi", async () => {
  const client = new ZccClient({
    accessToken: "token",
    fetchImpl: async () => new Response(JSON.stringify({ error: -201, message: "Invalid token" })),
  });

  await assert.rejects(
    client.checkConsent({ phone: "84773543888" }),
    (error) => error instanceof ZccError && error.code === -201,
  );
});

test("validate phone và tạo SIP target", () => {
  assert.equal(normalizePhone("+84773543888"), "84773543888");
  assert.throws(() => normalizePhone("0773 543 888"));
  assert.deepEqual(
    buildSipTarget({ appId: "9876543210", oaId: "1234567890", callee: "+84773543888" }),
    {
      domain: "9876543210.zcc.openapi.zaloapp.com",
      port: 5060,
      transport: "UDP/TCP",
      from: "sip:1234567890@9876543210.zcc.openapi.zaloapp.com",
      to: "sip:84773543888@9876543210.zcc.openapi.zaloapp.com",
    },
  );
});
