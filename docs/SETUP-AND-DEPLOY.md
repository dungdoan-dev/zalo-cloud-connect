# Huong dan setup server va deploy SimlyDent Zalo Cloud Connect

Tai lieu nay mo ta quy trinh cai dat moi mot may chu Ubuntu, dua FreeSWITCH va
ung dung Node.js vao systemd, cau hinh Zalo Cloud Connect (ZCC), sau do deploy
tu GitHub Actions. Cac lenh duoi day da duoc viet cho Ubuntu 24.04 va Elastic IP
`16.176.236.109`; hay thay bang gia tri cua he thong truoc khi chay.

> Khong commit Access Token, SIP password, private key `.pem`, `/etc/simlydent.env`
> hay thu muc `data/` vao Git. Token da tung duoc chia se de test can duoc thu hoi
> va tao lai trong Zalo Developer.

## 1. Kien truc sau khi hoan thanh

```text
Nhan vien
  -> Trinh duyet (HTTPS, SIP.js)
  -> Node.js /sip WebSocket proxy (WSS -> WS noi bo)
  -> FreeSWITCH (SIP/WebRTC, RTP, ghi am, dialplan)
  -> ZCC (SIP TCP + PCMU)
  -> Zalo User / so dien thoai da du dieu kien

Zalo webhook -> HTTPS /webhooks/zalo -> Node.js -> data/webhooks.ndjson
GitHub main -> Actions -> rsync -> /opt/simlydent -> systemd restart
```

Phan chia trach nhiem:

- **Node.js**: giao dien Settings/Softphone, luu cau hinh runtime, API Zalo,
  webhook, HTTPS/WSS proxy `/sip` khi dung reverse proxy hoac ngrok.
- **FreeSWITCH**: khong phai Node.js; day la SIP media server native. No xu ly
  SIP, WebRTC/DTLS/ICE, RTP va bridge den ZCC.
- **ZCC**: signaling toi `<AppID>.zcc.openapi.zaloapp.com:5060`, codec PCMU 8 kHz.

## 2. Chuan bi Zalo va AWS

### 2.1 Zalo Developer

1. Tao/duyet App va OA co quyen goi ZCC.
2. Trong ZCC Connection, khai bao **Elastic IP public** cua EC2, vi du
   `16.176.236.109`, port `5060`, TCP; bat cong vao va cong ra theo portal.
3. Tao routing ID cho tung OA. Inbound ID thuong co dang `OA_ID` + ma phan luong,
   vi du `4372227074994145661101`.
4. Lay OA Access Token chi de goi API xin/kiem tra consent. Cuoc goi SIP khong
   gui token nay trong INVITE.
5. Neu dung webhook, cau hinh URL HTTPS `/webhooks/zalo`. Endpoint phai tra `200`.

### 2.2 Security Group EC2

Tao inbound rules sau. Sau khi ZCC cung cap danh sach IP production, chi mo
`5060/TCP` cho cac IP do, khong de `0.0.0.0/0` lau dai.

| Muc dich | Protocol | Port | Source |
| --- | --- | ---: | --- |
| SSH quan tri | TCP | 22 | IP van phong/VPN cua ban |
| ZCC SIP | TCP | 5060 | ZCC source IP ranges |
| SIP noi bo/debug (neu can) | TCP/UDP | 5062 | IP tin cay |
| WebSocket noi bo (khong can public khi dung `/sip`) | TCP | 5066 | Khong expose public |
| WSS FreeSWITCH (neu dung truc tiep) | TCP | 7443 | Internet hoac IP tin cay |
| RTP | UDP | 10000-20000 | Internet/ZCC va client |
| Web app | TCP | 80, 443 | Internet |

Khong mo Event Socket `8021` ra Internet.

### 2.3 Ket noi SSH

Tren Windows, bao ve file PEM truoc khi dung:

```powershell
icacls E:\zalo-cloud-connect\deploy\key\anhdung.pem /inheritance:r
icacls E:\zalo-cloud-connect\deploy\key\anhdung.pem /grant:r "$env:USERNAME:(R)"
ssh -i E:\zalo-cloud-connect\deploy\key\anhdung.pem ubuntu@16.176.236.109
```

## 3. Cai dat Ubuntu mot lan

### 3.1 He dieu hanh, Node.js va nguoi dung dich vu

```bash
sudo apt update
sudo apt install -y ca-certificates curl git rsync build-essential pkg-config \
  nodejs npm

node --version                 # Can Node 18+, khuyen dung Node 20+
sudo useradd --system --home /opt/simlydent --shell /usr/sbin/nologin simlydent 2>/dev/null || true
sudo install -d -o simlydent -g simlydent /opt/simlydent
```

Neu `apt` cua Ubuntu khong co Node 20, cai Node 20 LTS tu nguon chinh thuc cua
NodeSource hoac package manager da duoc doanh nghiep phe duyet.

### 3.2 Cai FreeSWITCH tu source (khong can SignalWire repository token)

FreeSWITCH chay tai `/usr/local/freeswitch`. Cac package sau bao gom cac dependency
can cho SIP, PCMU, WebRTC va build co ban:

```bash
sudo apt install -y autoconf automake libtool cmake nasm yasm \
  libssl-dev libcurl4-openssl-dev libedit-dev libsqlite3-dev libpq-dev \
  libpcre2-dev libspeexdsp-dev libopus-dev libsndfile1-dev libmpg123-dev \
  libavformat-dev libavcodec-dev libavutil-dev libswresample-dev libldns-dev \
  libsofia-sip-ua-dev libspandsp-dev liblua5.4-dev libjpeg-dev libpng-dev

sudo install -d -o "$USER" -g "$USER" /usr/local/src
cd /usr/local/src
git clone https://github.com/signalwire/freeswitch.git
cd freeswitch
./bootstrap.sh
```

Ban source khong can `mod_signalwire` hay `mod_verto` cho ZCC. Neu `configure`
bao thieu `libks`, bo hai module nay khoi `modules.conf` truoc khi configure:

```bash
sed -i '/mod_signalwire/d; /mod_verto/d' modules.conf
export PKG_CONFIG_PATH=/usr/local/lib/pkgconfig:/usr/lib/x86_64-linux-gnu/pkgconfig
./configure --prefix=/usr/local/freeswitch
make -j2
sudo make install
sudo make samples
```

Neu configure bao thieu mot thu vien, cai package `*-dev` tuong ung, chay lai
`./configure`, roi moi chay `make`. Khong chay `make install` khi `configure`
hoac `make` dang loi.

Tao user va thu muc runtime:

```bash
sudo useradd --system --home /usr/local/freeswitch --shell /usr/sbin/nologin freeswitch 2>/dev/null || true
sudo chown -R freeswitch:freeswitch /usr/local/freeswitch
sudo install -d -o freeswitch -g freeswitch /usr/local/freeswitch/var/lib/freeswitch/recordings/zcc
```

Kiem tra binary:

```bash
/usr/local/freeswitch/bin/freeswitch -version
```

## 4. Dua source code len server lan dau

Thuc hien tu may phat trien sau khi da clone repository:

```bash
cd /duong-dan/toi/zalo-cloud-connect
npm ci
npm test

rsync -az --delete \
  --exclude '.git/' --exclude '.env' --exclude 'node_modules/' --exclude 'data/' \
  --exclude 'deploy/key/' \
  -e "ssh -i /duong-dan/anhdung.pem" \
  ./ ubuntu@16.176.236.109:/tmp/simlydent-deploy/

ssh -i /duong-dan/anhdung.pem ubuntu@16.176.236.109
sudo rsync -az --delete --exclude .env --exclude data/ /tmp/simlydent-deploy/ /opt/simlydent/
sudo bash /opt/simlydent/deploy/deploy-remote.sh
```

Script `deploy/deploy-remote.sh` cai systemd units, copy cau hinh FreeSWITCH,
dong bo RTP range 10000-20000 va khoi dong lai dich vu. Thu muc `/opt/simlydent/data`
duoc giu lai qua cac lan deploy; no chua Settings runtime va XML duoc sinh tu app.

## 5. Cau hinh runtime tren server

Tao `/etc/simlydent.env`. File nay la secret, chi root doc duoc.

```bash
sudo tee /etc/simlydent.env >/dev/null <<'EOF'
CALL_ENGINE=freeswitch

# Dia chi public duoc dua vao SDP va Settings (Elastic IP)
ZALO_PUBLIC_IP=16.176.236.109

# Node proxy WSS /sip den FreeSWITCH tren private IP
ZALO_LOCAL_IP=172.31.13.211
PBX_WS_UPSTREAM=ws://172.31.13.211:5066

# Gia tri public gui den trinh duyet. Khi web app chay HTTPS, nen dung /sip WSS proxy.
PBX_WSS_URL=wss://ten-mien-cua-ban/sip
PBX_SIP_DOMAIN=16.176.236.109

CONFIG_ADMIN_PASSWORD=doi-mat-khau-manh
WEBHOOK_SECRET=doi-secret-ngau-nhien

# Gia tri mac dinh cho OA dau tien. Settings co the quan ly nhieu OA sau do.
ZALO_OA_ACCESS_TOKEN=thay-bang-token-that
ZALO_APP_ID=your_zalo_app_id
ZALO_OA_ID=your_zalo_oa_id
EOF
sudo chmod 600 /etc/simlydent.env
```

`ZALO_LOCAL_IP` la private IPv4 cua EC2, lay bang:

```bash
ip -4 addr show enp39s0
# Hoac: hostname -I
```

Voi EC2 minh hoa, no la `172.31.13.211`; khong dung Elastic IP o
`PBX_WS_UPSTREAM`, vi day la ket noi noi bo Node -> FreeSWITCH.

FreeSWITCH can include runtime variables ma Node sinh ra:

```bash
sudo grep -q 'zcc-runtime-vars.xml' /usr/local/freeswitch/etc/freeswitch/vars.xml || \
  sudo sed -i '/<include>/a\  <X-PRE-PROCESS cmd="include" data="/opt/simlydent/data/zcc-runtime-vars.xml"/>' \
  /usr/local/freeswitch/etc/freeswitch/vars.xml
```

Kiem tra cac dich vu:

```bash
sudo systemctl status freeswitch simlydent --no-pager
sudo /usr/local/freeswitch/bin/fs_cli -x status
sudo /usr/local/freeswitch/bin/fs_cli -x 'sofia status'
sudo ss -lntup | grep -E ':5060|:5062|:5066|:7443|:8021'
```

Gia tri can thay:

- `zcc`: listen private IP `:5060`, public SIP/SDP la Elastic IP.
- `internal`: listen `:5062`, WS `:5066`; client Internet di qua WSS `/sip`.
- RTP: `10000-20000/UDP`.
- `8021`: chi duoc listen noi bo/server.

## 6. Cau hinh OA, nhan vien, may nhanh va luong goi

1. Mo `https://ten-mien-cua-ban/settings` (hoac `http://localhost:3000/settings`
   khi test local), nhap Admin password.
2. Buoc **Zalo OA**: tao tung OA, nhap App ID, OA ID, inbound route ID va Access Token.
3. Buoc **Nhan vien**: tao nhan vien. Nut them luu ngay qua API de tranh extension
   tham chieu nhan vien chua ton tai.
4. Buoc **May nhanh**: tao extension, SIP password, gan OA va gan nhan vien.
5. Buoc **Cuoc goi vao**: voi `Direct Extension`, chon mot nhan vien hoac extension
   cho tung OA. Chon nhan vien se do chuong cac extension hop le cua nhan vien do
   thuoc OA tuong ung.
6. Buoc **Ra soat & Luu**: luu toan bo; Node sinh directory/dialplan runtime va
   yeu cau FreeSWITCH reload XML.

Chi sau khi luu buoc cuoi FreeSWITCH moi nhan mapping moi. Neu thay doi tung buoc,
wizard luu draft de khong mat du lieu, nhung luong SIP production chi doi sau luu cuoi.

Kiem tra runtime:

```bash
sudo cat /opt/simlydent/data/zcc-runtime-vars.xml
sudo cat /opt/simlydent/data/freeswitch/directory.xml
sudo cat /opt/simlydent/data/freeswitch/dialplan.xml
sudo /usr/local/freeswitch/bin/fs_cli -x reloadxml
sudo /usr/local/freeswitch/bin/fs_cli -x 'sofia status profile internal reg'
```

## 7. HTTPS, WSS va webhook

Browser chi cho phep microphone/WebRTC o `localhost` hoac HTTPS. Khi web app duoc
public bang HTTPS, `ws://` la mixed content va se bi chan. Dung `wss://.../sip`.

### Test nhanh bang ngrok

Tren EC2:

```bash
ngrok http 3000
```

Dat `PBX_WSS_URL=wss://<ngrok-domain>/sip`, sau do:

```bash
sudo systemctl restart simlydent
curl -s https://<ngrok-domain>/api/config
```

Ngrok HTTP chi tunnel den Node port 3000. Node se proxy `/sip` den
`ws://172.31.13.211:5066`; khong dung `wss://<ngrok-domain>/sip` truc tiep voi
FreeSWITCH khi chua co Node proxy.

Webhook Zalo:

```bash
curl -i -X POST https://<domain>/webhooks/zalo \
  -H 'content-type: application/json' \
  -d '{"event_name":"health_check"}'

sudo tail -f /opt/simlydent/data/webhooks.ndjson
sudo journalctl -u simlydent -f -o cat
```

Endpoint phai tra `HTTP 200`. Neu Zalo gui header secret, dat dung
`WEBHOOK_SECRET`; neu portal test webhook tra `401`, kiem tra secret hoac cau hinh
xac thuc webhook truoc khi luu URL trong portal.

## 8. Thiet lap CI/CD GitHub Actions

Workflow la `.github/workflows/deploy.yml`: `npm ci` -> `npm test` -> `rsync`
source (bo qua `.env`, `data`, `node_modules`) -> chay `deploy-remote.sh`.

Trong GitHub repository: **Settings -> Secrets and variables -> Actions**, tao:

| Secret | Gia tri |
| --- | --- |
| `EC2_HOST` | Elastic IP hoac DNS public cua EC2, vi du `16.176.236.109` |
| `EC2_USER` | `ubuntu` |
| `EC2_SSH_KEY` | Toan bo private key PEM, bao gom dong BEGIN/END |

Khoi tao Git neu can:

```powershell
cd E:\zalo-cloud-connect
git config --global --add safe.directory E:/zalo-cloud-connect
git add .
git commit -m "Configure SimlyDent ZCC"
git branch -M main
git remote add origin https://github.com/<owner>/zalo-cloud-connect.git
git push -u origin main
```

Moi push len `main` se deploy. Co the chay thu cong trong GitHub Actions bang
**Run workflow**. Khong chay `rsync --delete` vao `/opt/simlydent` neu source
chua co du `deploy/`, vi service se khong the cai dat lai.

## 9. Van hanh hang ngay

### Dich vu va logs

```bash
sudo systemctl restart freeswitch simlydent
sudo systemctl stop simlydent
sudo systemctl start simlydent
sudo systemctl status freeswitch simlydent --no-pager

sudo journalctl -u freeswitch -f -o cat
sudo journalctl -u simlydent -f -o cat
sudo /usr/local/freeswitch/bin/fs_cli
```

Trong `fs_cli`:

```text
status
show channels
sofia status
sofia status profile internal reg
sofia global siptrace on
sofia global siptrace off
```

Khong chay them `/usr/local/freeswitch/bin/freeswitch -nf` neu systemd dang quan
ly FreeSWITCH; se bi loi lock PID. Dung `fs_cli` de vao process dang chay.

### Ghi am

```bash
sudo find /usr/local/freeswitch/var/lib/freeswitch/recordings/zcc -type f -printf '%TY-%Tm-%Td %TT %p\n' | sort
```

Can dam bao dung luat va duoc su dong y truoc khi ghi am/cu tru ban ghi.

### Kiem tra mot cuoc goi

```bash
sudo journalctl -u simlydent -f -o cat | grep -E 'sip-proxy|INVITE|REGISTER|SDP|error'
sudo journalctl -u freeswitch -f -o cat | grep -E 'INVITE|RTP|DTLS|ICE|Hangup|CALL_REJECTED'
sudo tcpdump -ni enp39s0 udp portrange 10000-20000
```

Lua chon luong goi:

- **UID**: goi `user_id@<AppID>.zcc.openapi.zaloapp.com`.
- **So dien thoai**: ZCC yeu cau E.164, vi du `+84372626121@<AppID>.zcc.openapi.zaloapp.com`.
- **Inbound**: ZCC gui `From=Zalo user ID`, `To=OA_ID + routing code`; dialplan
  doc `To` va bridge den extension/nhan vien da chon trong Settings.

## 10. Checklist go-live

- [ ] Elastic IP va ZCC Connection portal su dung cung mot IP/port TCP 5060.
- [ ] Security Group/UFW mo RTP UDP 10000-20000 va dong `8021` voi Internet.
- [ ] `sofia status profile zcc` va `internal` deu RUNNING.
- [ ] Softphone register thanh cong bang extension da duoc gan nhan vien.
- [ ] Trinh duyet dang chay HTTPS/WSS va duoc cap micro.
- [ ] Goi ZCC co `From=OA ID`, `To=UID` hoac `+84...`, nhan SIP 200/ACK.
- [ ] Co RTP hai chieu va khong co private IP `172.31.x.x` trong SDP public.
- [ ] Goi inbound ZCC do chuong dung extension/nhan vien da route.
- [ ] Webhook Zalo tra 200 va ghi duoc event.
- [ ] Ban ghi am (neu bat) nam trong thu muc dung va phan quyen dung.
- [ ] GitHub Actions deploy thanh cong; `/etc/simlydent.env` va `data/` khong bi ghi de.

## 11. Xu ly su co nhanh

| Hien tuong | Kiem tra dau tien |
| --- | --- |
| Browser bao insecure WebSocket | Trang HTTPS dang dung `ws://`; chuyen `PBX_WSS_URL` sang `wss://<domain>/sip`. |
| REGISTER 408 | Kiem tra log Node `/sip`, `sofia status profile internal`, va SIP.js gui `SIP/2.0/WS` khi proxy noi bo. |
| Goi bat may roi tu ngat/khong co tieng | Kiem tra ICE/DTLS, SDP co Elastic IP, Security Group UDP 10000-20000 va `tcpdump` co RTP hai chieu. |
| ZCC 403 | Kiem tra OA/App ID/domain, From la OA ID, To SĐT la `+84...`, va quyen goi cua Zalo. |
| ZCC 480 | User ID/SĐT khong du dieu kien goi, sai dinh dang, hoac Zalo client khong kha dung. |
| Webhook 401 | Kiem tra `WEBHOOK_SECRET` va header xac thuc portal gui sang. |
| Action deploy fail rsync | Dam bao `/opt/simlydent` thuoc `simlydent` hoac deploy qua `sudo rsync` nhu workflow. |
| `fs_cli` khong ket noi | `sudo systemctl status freeswitch --no-pager`, sau do kiem tra port local `8021`; khong mo port nay ra Internet. |

