# FreeSWITCH bridge for Zalo Cloud Connect

These files implement the production media path:

```text
Browser/SIP.js -- WSS + WebRTC --> FreeSWITCH -- SIP TCP + PCMU --> ZCC
```

## 1. Network

- NAT public `171.236.49.4:5060/TCP` to FreeSWITCH port `5060/TCP`.
- NAT RTP UDP `10000-20000` without changing port numbers.
- Publish `7443/TCP` for WSS.
- Do not expose Event Socket `8021` to the Internet.
- The Linux server must use a static private IP behind NAT.
- The dedicated `zcc` profile binds local port `5060`. Move the vanilla `internal`
  profile SIP port to `5062` (WSS remains `7443`) if it currently occupies `5060`.
- Set `rtp-start-port=10000` and `rtp-end-port=20000` in
  `/etc/freeswitch/autoload_configs/switch.conf.xml`.
- Before go-live, restrict inbound `5060/TCP` in the firewall to the official ZCC
  source IP ranges supplied for the tenant. They are not guessed in this template.

## 2. Copy configuration

FreeSWITCH configuration is usually under `/etc/freeswitch`.

```bash
sudo install -m 0644 conf/sip_profiles/zcc.xml /etc/freeswitch/sip_profiles/zcc.xml
sudo install -m 0644 conf/dialplan/default/10_zcc_outbound.xml /etc/freeswitch/dialplan/default/10_zcc_outbound.xml
sudo install -m 0644 conf/dialplan/zcc.xml /etc/freeswitch/dialplan/zcc.xml
sudo install -m 0640 conf/directory/default/1001.xml /etc/freeswitch/directory/default/1001.xml
```

Copy the five `X-PRE-PROCESS` entries from `conf/zcc-vars.xml` into the existing
`/etc/freeswitch/vars.xml`. Do not replace the complete vanilla `vars.xml`.

Change `CHANGE_ME_STRONG_PASSWORD` in extension `1001.xml` before reload.

## 3. Enable WebRTC on the internal profile

The internal SIP profile must contain:

```xml
<param name="ws-binding" value=":5066"/>
<param name="wss-binding" value=":7443"/>
```

Install a valid certificate for `pbx.simlydent.vn` using the certificate layout
required by the installed FreeSWITCH version. A browser will reject a self-signed
certificate for production WSS.

## 4. Validate and reload

```bash
sudo freeswitch -nonat -ncwait
fs_cli -x "reloadxml"
fs_cli -x "sofia profile zcc start"
fs_cli -x "sofia status profile zcc"
fs_cli -x "sofia status profile internal"
```

If FreeSWITCH is already managed by systemd, restart it using the package service
instead of starting a second process.

Enable SIP tracing only while debugging:

```bash
fs_cli -x "sofia global siptrace on"
fs_cli -x "sofia global siptrace off"
```

## 5. Application

Set in the Node application `.env`:

```dotenv
CALL_ENGINE=freeswitch
PBX_WSS_URL=wss://pbx.simlydent.vn:7443
PBX_SIP_DOMAIN=pbx.simlydent.vn
```

Run `npm run server`, open `/softphone`, enter extension `1001` and its password,
then REGISTER. Dial the phone in international format such as `84372626121`, or a
numeric Zalo User ID.

## 6. Expected ZCC identities

- Outbound From: `2565558072518292002`
- ZCC domain: `4598831758752463028.zcc.openapi.zaloapp.com`
- Inbound destination/route: `2565558072518292002101`
- Codec to ZCC: PCMU/8000
- Signaling to ZCC: TCP/5060

The inbound dialplan currently rings extension `1001`. Replace `user/1001` with a
FreeSWITCH callcenter queue after the single-agent flow is accepted.
