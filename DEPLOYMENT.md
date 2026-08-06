# Production deployment checklist

## Node application

```powershell
npm.cmd install
Copy-Item .env.example .env
notepad .env
npm.cmd test
npm.cmd run server
```

Open:

- POC direct SIP/RTP: `http://localhost:3000/`
- FreeSWITCH softphone: `http://localhost:3000/softphone`

For production, put Node behind HTTPS and set `CALL_ENGINE=freeswitch`. Browser
microphone and WSS require a secure context (`https://`), except on localhost.

## FreeSWITCH

Follow `deploy/freeswitch/README.md`. Complete the first acceptance test in this
order:

1. SIP.js REGISTER extension `1001` through WSS.
2. Call `1001` from another extension and verify two-way browser audio.
3. Call a consented ZCC phone/User ID and verify SIP 200/ACK/BYE.
4. Verify two-way PCMU RTP and that SDP contains the server public IP `16.176.236.109`.
5. Make an inbound ZCC call to route `101`; extension `1001` must ring.

Do not add queues, recordings or CRM automation until all five checks pass.
