#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/simlydent
FS_DIR=/usr/local/freeswitch
FS_CONF="$FS_DIR/etc/freeswitch"

sudo install -d -o simlydent -g simlydent "$APP_DIR"
sudo install -d -o freeswitch -g freeswitch "$FS_DIR/var/lib/freeswitch/recordings/zcc"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required on the server (install Node.js 20+ first)." >&2
  exit 1
fi

sudo install -m 0644 deploy/systemd/simlydent.service /etc/systemd/system/simlydent.service
sudo install -m 0644 deploy/systemd/freeswitch.service /etc/systemd/system/freeswitch.service

sudo install -m 0644 deploy/freeswitch/conf/sip_profiles/zcc.xml "$FS_CONF/sip_profiles/zcc.xml"
sudo install -m 0644 deploy/freeswitch/conf/dialplan/default/05_zcc_inbound.xml "$FS_CONF/dialplan/default/05_zcc_inbound.xml"
sudo install -m 0644 deploy/freeswitch/conf/dialplan/default/10_zcc_outbound.xml "$FS_CONF/dialplan/default/10_zcc_outbound.xml"
sudo install -m 0644 deploy/freeswitch/conf/dialplan/zcc.xml "$FS_CONF/dialplan/zcc.xml"

sudo chown -R simlydent:simlydent "$APP_DIR"
sudo chown -R freeswitch:freeswitch "$FS_DIR/var/lib/freeswitch/recordings"
sudo -u simlydent npm ci --omit=dev

sudo systemctl daemon-reload
sudo systemctl enable freeswitch.service simlydent.service
sudo systemctl restart freeswitch.service
sleep 2
sudo /usr/local/freeswitch/bin/fs_cli -x reloadxml
sudo /usr/local/freeswitch/bin/fs_cli -x 'sofia profile zcc restart' || true
sudo systemctl restart simlydent.service
sudo systemctl --no-pager --full status freeswitch.service simlydent.service
