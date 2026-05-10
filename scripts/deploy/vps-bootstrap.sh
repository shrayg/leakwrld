#!/usr/bin/env bash
#
# Run ON the VPS as root after you SSH in (Ubuntu 22.04/24.04).
# Usage:
#   sudo bash vps-bootstrap.sh
#
# Does NOT contain secrets — generates DB password and prints DATABASE_URL once.
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/leakwrld}"
APP_USER_SYS="${APP_USER_SYS:-leakwrld}"
DB_NAME="${DB_NAME:-leakworld}"
DB_ROLE="${DB_ROLE:-leakworld}"
REPO_URL="${REPO_URL:-https://github.com/shrayg/leakwrld.git}"
NODE_MAJOR="${NODE_MAJOR:-20}"

echo "==> Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates git postgresql postgresql-contrib nginx

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p process.versions.node | cut -d. -f1)" -lt "$NODE_MAJOR" ]]; then
  echo "==> Installing Node.js ${NODE_MAJOR}.x (NodeSource)"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

echo "==> Creating system user ${APP_USER_SYS}"
LEAK_HOME="/home/${APP_USER_SYS}"
if ! id -u "${APP_USER_SYS}" >/dev/null 2>&1; then
  useradd --system --shell /bin/bash --home-dir "${LEAK_HOME}" --create-home "${APP_USER_SYS}"
else
  if [[ ! -d "${LEAK_HOME}" ]]; then
    mkdir -p "${LEAK_HOME}"
    chown "${APP_USER_SYS}:${APP_USER_SYS}" "${LEAK_HOME}"
    usermod --home "${LEAK_HOME}" "${APP_USER_SYS}" 2>/dev/null || true
  fi
fi
mkdir -p "${APP_DIR}"
chown "${APP_USER_SYS}:${APP_USER_SYS}" "${APP_DIR}"

echo "==> PostgreSQL role + database"
DB_PASS="$(openssl rand -hex 24)"

sudo -u postgres psql -v ON_ERROR_STOP=1 <<EOF
DO \$\$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_ROLE}') THEN
    EXECUTE format('ALTER ROLE %I WITH PASSWORD %L', '${DB_ROLE}', '${DB_PASS}');
  ELSE
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', '${DB_ROLE}', '${DB_PASS}');
  END IF;
END
\$\$;
EOF

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "${DB_ROLE}" "${DB_NAME}"
fi
sudo -u postgres psql -d "${DB_NAME}" -v ON_ERROR_STOP=1 -c "GRANT ALL ON SCHEMA public TO ${DB_ROLE};"

DATABASE_URL="postgres://${DB_ROLE}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}"

echo "==> Cloning / updating app"
# If /opt/leakwrld was cloned manually as root, git run as ${APP_USER_SYS} hits "dubious ownership".
chown -R "${APP_USER_SYS}:${APP_USER_SYS}" "${APP_DIR}" 2>/dev/null || true
sudo -u "${APP_USER_SYS}" git config --global --add safe.directory "${APP_DIR}" 2>/dev/null || true

if [[ -d "${APP_DIR}/.git" ]]; then
  sudo -u "${APP_USER_SYS}" git -C "${APP_DIR}" pull --ff-only
else
  rm -rf "${APP_DIR}"
  mkdir -p "$(dirname "${APP_DIR}")"
  sudo -u "${APP_USER_SYS}" git clone "${REPO_URL}" "${APP_DIR}"
fi
chown -R "${APP_USER_SYS}:${APP_USER_SYS}" "${APP_DIR}"

SESSION_SECRET="$(openssl rand -hex 32)"
ENV_FILE="${APP_DIR}/.env"
sudo -u "${APP_USER_SYS}" bash -c "cat > '${ENV_FILE}'" <<EOF
DATABASE_URL=${DATABASE_URL}
SESSION_SECRET=${SESSION_SECRET}
PORT=3002
HOST=127.0.0.1
# Set SECURE_COOKIES=1 after HTTPS (Certbot); Secure lw_session cookies are ignored over plain HTTP.
SECURE_COOKIES=0
EOF
chmod 600 "${ENV_FILE}"
chown "${APP_USER_SYS}:${APP_USER_SYS}" "${ENV_FILE}"

echo "==> npm install + build"
sudo -u "${APP_USER_SYS}" bash -lc "cd '${APP_DIR}' && npm ci && npm run build"

echo "==> Apply database schema"
sudo -u "${APP_USER_SYS}" bash -lc "cd '${APP_DIR}' && set -a && . '${ENV_FILE}' && set +a && npm run db:schema"

echo "==> systemd unit"
cat >/etc/systemd/system/leakwrld.service <<EOF
[Unit]
Description=Leak World Node API + static
After=network.target postgresql.service

[Service]
Type=simple
User=${APP_USER_SYS}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable leakwrld
systemctl restart leakwrld

echo "==> nginx reverse proxy (HTTP :80 -> 127.0.0.1:3002)"
cat >/etc/nginx/sites-available/leakwrld <<'NGX'
server {
    listen 80;
    listen [::]:80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGX
ln -sf /etc/nginx/sites-available/leakwrld /etc/nginx/sites-enabled/leakwrld
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t && systemctl reload nginx

echo ""
echo "------------------------------------------------------------------------------"
echo "Bootstrap finished."
echo "App:      ${APP_DIR}"
echo "Service:  systemctl status leakwrld"
echo "DB URL:   (stored in ${ENV_FILE} — back it up securely)"
echo ""
echo "IMPORTANT: Save DATABASE_URL from .env in your password manager; it was shown only at generation."
echo "------------------------------------------------------------------------------"
