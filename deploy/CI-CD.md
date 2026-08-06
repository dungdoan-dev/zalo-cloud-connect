# CI/CD lên EC2

Workflow `.github/workflows/deploy.yml` chạy test rồi đồng bộ code lên `/opt/simlydent`.

## GitHub Secrets cần tạo

- `EC2_HOST`: `16.176.236.109` (nên dùng Elastic IP hoặc hostname cố định)
- `EC2_USER`: `ubuntu`
- `EC2_SSH_KEY`: toàn bộ nội dung private key dùng để SSH EC2

Không commit `.env`, token Zalo, mật khẩu SIP hoặc file `.pem`.

## Chuẩn bị một lần trên Ubuntu

```bash
sudo apt update
sudo apt install -y nodejs npm rsync
sudo useradd --system --home /opt/simlydent --shell /usr/sbin/nologin simlydent 2>/dev/null || true
sudo install -d -o simlydent -g simlydent /opt/simlydent
sudo install -d -o freeswitch -g freeswitch /usr/local/freeswitch/var/lib/freeswitch/recordings/zcc
```

Tạo `/etc/simlydent.env` trên server và đặt các biến runtime, không đưa file này vào Git:

```dotenv
CALL_ENGINE=freeswitch
PBX_WSS_URL=ws://16.176.236.109:5066
PBX_SIP_DOMAIN=16.176.236.109
CONFIG_ADMIN_PASSWORD=MAT_KHAU_QUAN_TRI_MOI
# Chỉ đặt WEBHOOK_SECRET nếu bên gửi webhook hỗ trợ gửi X-Webhook-Secret.
ZALO_OA_ACCESS_TOKEN=...
ZALO_APP_ID=4598831758752463028
ZALO_OA_ID=2565558072518292002
```

Sau khi push vào branch `main`, Actions sẽ chạy test, upload code, reload dialplan và restart FreeSWITCH/Node.
