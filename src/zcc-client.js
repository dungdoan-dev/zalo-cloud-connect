const DEFAULT_BASE_URL = "https://openapi.zalo.me";
const ALLOWED_CALL_TYPES = new Set(["audio", "video", "audio_and_video"]);
const ALLOWED_REASON_CODES = new Set([101, 103, 105, 106, 107]);

export class ZccError extends Error {
  constructor(message, { status, code, response } = {}) {
    super(message);
    this.name = "ZccError";
    this.status = status;
    this.code = code;
    this.response = response;
  }
}

export function normalizePhone(phone) {
  const normalized = String(phone ?? "").trim().replace(/^\+/, "");
  if (!/^\d{8,15}$/.test(normalized)) {
    throw new TypeError(
      "Số điện thoại phải ở định dạng quốc tế, chỉ gồm 8-15 chữ số (ví dụ: 84773543888).",
    );
  }
  return normalized;
}

export class ZccClient {
  constructor({ accessToken, baseUrl = DEFAULT_BASE_URL, fetchImpl = globalThis.fetch } = {}) {
    if (!accessToken?.trim()) {
      throw new TypeError("Thiếu OA Access Token.");
    }
    if (typeof fetchImpl !== "function") {
      throw new TypeError("Môi trường hiện tại không hỗ trợ fetch.");
    }

    this.accessToken = accessToken.trim();
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetch = fetchImpl;
  }

  async requestConsent({ phone, callType = "audio", reasonCode = 101 }) {
    const normalizedPhone = normalizePhone(phone);
    if (!ALLOWED_CALL_TYPES.has(callType)) {
      throw new TypeError("callType phải là audio, video hoặc audio_and_video.");
    }

    const numericReasonCode = Number(reasonCode);
    if (!ALLOWED_REASON_CODES.has(numericReasonCode)) {
      throw new TypeError("reasonCode phải là một trong: 101, 103, 105, 106, 107.");
    }

    return this.#request("/v2.0/oa/call/requestconsent", {
      method: "POST",
      body: JSON.stringify({
        phone: normalizedPhone,
        call_type: callType,
        reason_code: numericReasonCode,
      }),
    });
  }

  async checkConsent({ phone }) {
    const data = encodeURIComponent(JSON.stringify({ phone: normalizePhone(phone) }));
    return this.#request(`/v2.0/oa/call/checkconsent?data=${data}`, { method: "GET" });
  }

  async #request(path, init) {
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          access_token: this.accessToken,
        },
      });
    } catch (cause) {
      throw new ZccError(`Không thể kết nối Zalo OpenAPI: ${cause.message}`, { response: cause });
    }

    const rawBody = await response.text();
    let payload;
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      throw new ZccError("Zalo OpenAPI trả về dữ liệu không phải JSON.", {
        status: response.status,
        response: rawBody,
      });
    }

    const hasError =
      !response.ok ||
      (typeof payload.error === "number" && payload.error !== 0) ||
      (typeof payload.code === "number" && payload.code !== 0) ||
      (typeof payload.error === "string" && payload.error.length > 0);

    if (hasError) {
      const message =
        payload.message ||
        (typeof payload.error === "string" ? payload.error : null) ||
        `Zalo OpenAPI trả về HTTP ${response.status}.`;
      const code =
        payload.code ?? (typeof payload.error === "number" ? payload.error : undefined);
      throw new ZccError(message, {
        status: response.status,
        code,
        response: payload,
      });
    }

    return payload;
  }
}

export function buildSipTarget({ appId, oaId, callee }) {
  const normalizedAppId = validateNumericId(appId, "App ID");
  const normalizedOaId = validateNumericId(oaId, "OA ID");
  const normalizedCallee = String(callee ?? "").trim();
  if (!/^\+?\d+$/.test(normalizedCallee)) {
    throw new TypeError("Callee phải là số điện thoại hoặc Zalo User ID dạng số.");
  }

  const domain = `${normalizedAppId}.zcc.openapi.zaloapp.com`;
  return {
    domain,
    port: 5060,
    transport: "UDP/TCP",
    from: `sip:${normalizedOaId}@${domain}`,
    to: `sip:${normalizedCallee}@${domain}`,
  };
}

function validateNumericId(value, label) {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized)) {
    throw new TypeError(`${label} phải là chuỗi số.`);
  }
  return normalized;
}
