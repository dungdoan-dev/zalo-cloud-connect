# Zalo Cloud Connect bằng OA Access Token

Dự án cung cấp CLI tối giản để:

1. Gửi yêu cầu người dùng cấp quyền gọi qua Zalo OA.
2. Kiểm tra người dùng đã cấp quyền gọi hay chưa.
3. Tạo SIP URI để PBX/SBC thực hiện cuộc gọi qua ZCC.

> OA Access Token chỉ dùng cho hai API cấp/kiểm tra quyền. Cuộc gọi thực tế đi
> qua SIP trunk của tổng đài tới `<AppID>.zcc.openapi.zaloapp.com:5060`.

## Yêu cầu

- Node.js 18 trở lên.
- OA Doanh nghiệp đã xác thực.
- App đã được duyệt và OA cấp **quyền sử dụng chức năng gọi thoại**.
- OA Access Token V4.
- PBX/SBC đã khai báo IP public và cấu hình SIP trunk theo tài liệu ZCC.

## Cấu hình

PowerShell:

```powershell
$env:ZALO_OA_ACCESS_TOKEN='oa-access-token'
$env:ZALO_APP_ID='9876543210'
$env:ZALO_OA_ID='1234567890'
$env:ZALO_PUBLIC_IP='16.176.236.109'
$env:ZALO_RTP_MIN_PORT='10000'
$env:ZALO_RTP_MAX_PORT='10100'
```

Không commit token vào source code hoặc file `.env`.

Router/firewall phải NAT UDP `10000-10100` từ public IP vào đúng máy chạy ứng
dụng và giữ nguyên số cổng. SDP sẽ quảng bá public IP cùng cổng RTP đã bind.
Cổng `5060/TCP` chỉ dùng cho SIP signaling, không truyền âm thanh.

## Giao diện gọi có âm thanh

```powershell
npm run server
```

Mở `http://localhost:3000`, nhập User ID hoặc số điện thoại rồi bấm gọi. Trình
duyệt sẽ yêu cầu quyền microphone. Trang phải chạy trên `localhost` hoặc HTTPS.

```text
Microphone → PCM 8 kHz → WebSocket → PCMU/RTP → ZCC
ZCC → PCMU/RTP → WebSocket → Web Audio → Loa
```

## Sử dụng

Gửi yêu cầu cấp quyền gọi:

```powershell
node src/cli.js request-consent --phone 84773543888 --type audio --reason 101
```

Kiểm tra quyền gọi:

```powershell
node src/cli.js check-consent --phone 84773543888
```

Tạo thông số SIP outbound sau khi khách đã đồng ý:

```powershell
node src/cli.js sip-target --callee 84773543888
```

Kết quả gồm domain SIP, `From` là OA ID và `To` là số điện thoại/User ID. PBX
cần phát SIP INVITE bằng các thông số này; CLI không giả lập một tổng đài SIP.

Các loại cuộc gọi: `audio`, `video`, `audio_and_video`.

Các mã lý do:

- `101`: Tư vấn sản phẩm/dịch vụ
- `103`: Xác nhận đơn hàng/cuộc hẹn
- `105`: Thông báo giao hàng
- `106`: Thông báo chuyến bay
- `107`: Cập nhật đơn hàng

## Kiểm thử

```powershell
npm test
```

Test dùng mock `fetch`, không gửi request thật và không cần token.

## Tài liệu chính thức

- [Tổng quan gọi thoại ZCC](https://docs.zaloplatforms.com/docs/OA/goi-thoai/tong-quan)
- [Gửi yêu cầu cấp quyền gọi](https://docs.zaloplatforms.com/docs/OA/goi-thoai/cap-quyen-goi/gui-yeu-cau-cap-quyen-goi)
- [Kiểm tra quyền gọi](https://docs.zaloplatforms.com/docs/OA/goi-thoai/cap-quyen-goi/kiem-tra-nguoi-dung-da-cap-quyen-goi)

## Triển khai production

Xem hướng dẫn đầy đủ từ tạo EC2, cài FreeSWITCH/Node.js, cấu hình ZCC, HTTPS,
webhook, systemd, theo dõi log đến GitHub Actions CI/CD tại
[docs/SETUP-AND-DEPLOY.md](docs/SETUP-AND-DEPLOY.md).
