# WhatsApp Business Calling qua FreeSWITCH

Tai lieu nay mo ta phan WhatsApp Business Calling cua SimlyDent. No la mot kenh
doc lap voi Zalo Cloud Connect: token, webhook, SIP profile, dialplan va thu muc
ghi am khong dung chung voi ZCC.

> Gioi han Meta: so WhatsApp Business co ma quoc gia `+84` **khong duoc phep
> doanh nghiep khoi tao cuoc goi ra**. Van co the nhan cuoc goi do khach hang
> khoi tao. Giao dien se hien ro che do inbound-only nay va khong cho quay so
> ra bang tai khoan `+84`.

Nguon chinh thuc: [WhatsApp Business Calling](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/)
va [SIP Calling](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/sip/).

## 1. Dieu kien truoc khi bat dau

- WhatsApp Business Platform / Cloud API, **khong** phai WhatsApp Business App.
- Meta App o Live mode va da subscribe vao WABA; cac quyen Graph phu hop duoc
  cap Advanced Access theo yeu cau cua Meta.
- Business Phone Number va Phone Number ID trong WhatsApp Manager.
- Mot FQDN public, vi du `voice.example.com`, co ban ghi A tro toi Elastic IP.
  Khong dung IP truc tiep hay ngrok cho SIP server cua Meta.
- TLS certificate cong khai hop le, SAN/CN trung voi FQDN. Meta khong dung mTLS.
- FreeSWITCH co `mod_sofia`, OPUS va TLS; Node.js 18+.

SIP cua Meta dung TLS `5061`; WebRTC media dung ICE + DTLS-SRTP. Profile cua
du an uu tien OPUS va bat them PCMU/PCMA theo cau hinh Calling cua Meta.

## 2. DNS, certificate va firewall

1. Tao `A voice.example.com -> <Elastic-IP>`.
2. Cai certificate cho FreeSWITCH. Profile
   `deploy/freeswitch/conf/sip_profiles/whatsapp.xml` dung certificate layout
   `agent.pem` cua FreeSWITCH. Certificate nay phai gom day du private key va
   certificate chain, va duoc FreeSWITCH doc duoc.
3. Mo AWS Security Group/UFW:

| Muc dich | Protocol | Port | Source |
| --- | --- | ---: | --- |
| Meta SIP TLS inbound | TCP | 5061 | Meta SIP source ranges |
| Media RTP | UDP | 10000-20000 | Meta va browser/client hop le |
| Web app + webhook | TCP | 443 | Internet |

Khong mo `8021` (FreeSWITCH Event Socket). Profile WhatsApp khong dung local
directory auth cho inbound Meta, vi vay **bat buoc** gioi han TCP `5061` theo
danh sach IP Meta duoc cong bo trong Meta dashboard/tai lieu hien hanh.

Kiem tra TLS tu mot may ngoai Internet:

```bash
openssl s_client -connect voice.example.com:5061 -servername voice.example.com \
  -verify_hostname voice.example.com </dev/null
```

## 3. Deploy phan mem

Push code va chay CI/CD nhu binh thuong. `deploy/deploy-remote.sh` se:

- copy profile `whatsapp.xml`;
- include runtime variables an toan `whatsapp-vars.xml`;
- symlink dialplan runtime `01_whatsapp.xml`;
- tao `recordings/whatsapp`;
- reload XML va restart Sofia profile `whatsapp`.

Sau deploy, kiem tra:

```bash
sudo /usr/local/freeswitch/bin/fs_cli -x 'sofia status profile whatsapp'
sudo ss -lntp | grep ':5061'
sudo journalctl -u freeswitch -f -o cat
```

Neu profile chua RUNNING, kiem tra certificate va cac bien `whatsapp_*` trong:

```bash
sudo cat /opt/simlydent/data/freeswitch/whatsapp-vars.xml
sudo systemctl restart freeswitch
```

## 4. Cau hinh trong giao dien

1. Mo `https://<app-domain>/whatsapp` va nhap `CONFIG_ADMIN_PASSWORD`.
2. Nhap Phone Number ID, WABA ID (neu co), business phone E.164, System User
   Access Token, Meta App Secret va webhook verify token.
3. Nhap SIP FQDN `voice.example.com`, port `5061`, va chon extension hoac nhan
   vien nhan cuoc goi vao.
4. Bam **Luu & nap FreeSWITCH**. Secret da luu khong bao gio duoc render lai
   tren trinh duyet.
5. Bam **Dong bo SIP voi Meta**. Server goi Graph API settings theo thong tin
   vua luu; thao tac nay chi xay ra khi quan tri vien chu dong bam nut.
6. Bam **Lay Meta SIP password**. Password Meta sinh theo cap Business Phone +
   App duoc luu server-side, cap nhat runtime va restart profile. Khong copy no
   vao Git, `.env.example` hay chat.

Voi cau hinh SIP, Meta yeu cau caller SIP cua doanh nghiep dung business phone
E.164 va From host trung FQDN da khai bao. Outbound SIP URI cua Meta co dang
`sip:+<customer-e164>@wa.meta.vc;transport=tls`; Meta phan hoi `407`, sau do
FreeSWITCH gateway tu Digest-auth bang Meta SIP password.

## 5. Meta webhook

Dat Callback URL trong Meta App Dashboard:

```text
https://<app-domain>/webhooks/whatsapp
```

Verify Token phai trung voi truong trong `/whatsapp`. Server xu ly dung giao
thuc Meta:

- `GET`: tra plain-text `hub.challenge` khi `hub.verify_token` dung.
- `POST`: kiem tra `X-Hub-Signature-256` bang HMAC SHA-256 cua Meta App Secret
  truoc khi ghi event.

Webhook log nam tai:

```bash
sudo tail -f /opt/simlydent/data/webhooks.ndjson
sudo journalctl -u simlydent -f -o cat
```

Log co metadata `provider: "whatsapp"`; payload van duoc giu de doi soat call
lifecycle, nhung khong dua secret vao log.

## 6. Luong cuoc goi

```text
Khach WhatsApp
  -> Meta TLS SIP INVITE (WACID / BSUID headers)
  -> FreeSWITCH profile whatsapp :5061
  -> Dialplan WhatsApp theo extension hoac nhan vien da chon
  -> SIP.js browser extension

Nhan vien
  -> Floating softphone
  -> FreeSWITCH internal profile
  -> WhatsApp gateway TLS -> wa.meta.vc (chi khi business phone khong phai +84)
```

Ban ghi am cua WhatsApp duoc FreeSWITCH luu rieng:

```bash
sudo find /usr/local/freeswitch/var/lib/freeswitch/recordings/whatsapp -type f
```

Can dam bao tuan thu quy dinh phap luat va thong bao/lay dong y ghi am truoc khi
van hanh production.

## 7. Debug

```bash
sudo /usr/local/freeswitch/bin/fs_cli -x 'sofia status profile whatsapp'
sudo /usr/local/freeswitch/bin/fs_cli -x 'sofia global siptrace on'
sudo journalctl -u freeswitch -f -o cat | grep -E 'whatsapp|wa.meta.vc|WACID|DTLS|ICE|RTP'
sudo tcpdump -ni enp39s0 'tcp port 5061 or udp portrange 10000-20000'
```

Tat siptrace sau khi xong vi no co the ghi SIP headers nhay cam vao log:

```bash
sudo /usr/local/freeswitch/bin/fs_cli -x 'sofia global siptrace off'
```

