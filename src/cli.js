#!/usr/bin/env node
import { buildSipTarget, ZccClient, ZccError } from "./zcc-client.js";
import { SipCaller } from "./sip-caller.js";

const [, , command, ...args] = process.argv;
// Flags boolean: khai báo trước khi gọi parseOptions
const BOOL_FLAGS = new Set(["verbose", "v"]);
const options = parseOptions(args);

try {
  let result;
  switch (command) {
    case "request-consent": {
      const client = createClient(options);
      result = await client.requestConsent({
        phone: required(options, "phone"),
        callType: options.type ?? "audio",
        reasonCode: options.reason ?? 101,
      });
      break;
    }
    case "check-consent": {
      const client = createClient(options);
      result = await client.checkConsent({ phone: required(options, "phone") });
      break;
    }
    case "sip-target":
      result = buildSipTarget({
        appId: options["app-id"] ?? process.env.ZALO_APP_ID,
        oaId: options["oa-id"] ?? process.env.ZALO_OA_ID,
        callee: required(options, "callee"),
      });
      break;
    case "call": {
      const sipInfo = buildSipTarget({
        appId: options["app-id"] ?? process.env.ZALO_APP_ID,
        oaId:  options["oa-id"]  ?? process.env.ZALO_OA_ID,
        callee: required(options, "callee"),
      });
      const verbose = options["verbose"] !== undefined || options["v"] !== undefined;
      const caller = new SipCaller({
        // Outbound From dùng OA ID nguyên bản; OA_ID + route ID chỉ dành cho inbound To.
        fromUri:   sipInfo.from,
        domain:    sipInfo.domain,
        port:      sipInfo.port,
        localIp:   options["local-ip"],
        advertisedIp: options["public-ip"] ?? process.env.ZALO_PUBLIC_IP,
        rtpMinPort: options["rtp-min-port"] ?? process.env.ZALO_RTP_MIN_PORT,
        rtpMaxPort: options["rtp-max-port"] ?? process.env.ZALO_RTP_MAX_PORT,
        transport: options["transport"] ?? "tcp",
        verbose,
      });
      caller.on("calling",   ({ toUri }) => console.error(`📞 Đang gọi ${toUri}...`));
      caller.on("ringing",   ()          => console.error("🔔 Đang đổ chuông..."));
      caller.on("connected", ({ remoteRtpIp, remoteRtpPort }) =>
        console.error(`✅ Đã kết nối! RTP: ${remoteRtpIp}:${remoteRtpPort}`));
      caller.on("ended",     ({ reason }) => console.error(`📴 Cuộc gọi kết thúc: ${reason}`));
      caller.on("failed",    (err)        => console.error(`❌ Thất bại: ${err.message}`));
      caller.on("sip",       ({ status, reason }) => console.error(`   SIP ${status} ${reason}`));
      process.once("SIGINT", () => { caller.hangup(); });
      result = await caller.call(sipInfo.to, {
        ringTimeout:  parseInt(options["ring-timeout"]  ?? "60000"),
        callDuration: parseInt(options["call-duration"] ?? "30000"),
      });
      break;
    }
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      process.exitCode = command ? 0 : 1;
      break;
    default:
      throw new TypeError(`Lệnh không hợp lệ: ${command}`);
  }

  if (result) console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (error instanceof ZccError && error.code !== undefined) {
    console.error(`ZCC lỗi ${error.code}: ${error.message}`);
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
}

function createClient(options) {
  return new ZccClient({
    accessToken: options.token ?? process.env.ZALO_OA_ACCESS_TOKEN,
    baseUrl: process.env.ZALO_OPENAPI_BASE_URL,
  });
}

function required(options, key) {
  if (!options[key]) throw new TypeError(`Thiếu tham số --${key}.`);
  return options[key];
}

// Flags không cần value (boolean) – defined above near top

function parseOptions(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) throw new TypeError(`Tham số không hợp lệ: ${argument}`);
    const [rawKey, inlineValue] = argument.slice(2).split("=", 2);
    if (BOOL_FLAGS.has(rawKey)) { result[rawKey] = true; continue; }
    const value = inlineValue ?? args[index + 1];
    if (!value || value.startsWith("--")) throw new TypeError(`Thiếu giá trị cho --${rawKey}.`);
    result[rawKey] = value;
    if (inlineValue === undefined) index += 1;
  }
  return result;
}

function printHelp() {
  console.log(`Zalo Cloud Connect CLI

Cách dùng:
  node src/cli.js request-consent --phone 84773543888 [--type audio] [--reason 101]
  node src/cli.js check-consent --phone 84773543888
  node src/cli.js sip-target --callee 84773543888 [--app-id ID] [--oa-id ID]
  node src/cli.js call --callee 84773543888 [--app-id ID] [--oa-id ID]
                       [--ring-timeout 60000] [--call-duration 30000]
                       [--local-ip 192.168.1.190] [--public-ip 16.176.236.109]
                       [--rtp-min-port 10000] [--rtp-max-port 10100]

Biến môi trường:
  ZALO_OA_ACCESS_TOKEN  OA Access Token V4 có quyền gọi thoại
  ZALO_APP_ID           App ID dùng tạo SIP domain
  ZALO_OA_ID            OA ID dùng làm SIP caller
  ZALO_PUBLIC_IP        Public IP quảng bá trong SDP
  ZALO_RTP_MIN_PORT     Cổng đầu dải RTP UDP
  ZALO_RTP_MAX_PORT     Cổng cuối dải RTP UDP

Reason code: 101 tư vấn, 103 xác nhận đơn/lịch hẹn, 105 giao hàng,
             106 chuyến bay, 107 cập nhật đơn hàng.`);
}
