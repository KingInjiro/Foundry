#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
ARCHIVE=""
PUBLIC_URL=""
while [[ "$#" -gt 0 ]]; do
    case "$1" in
        --archive) ARCHIVE="${2:-}"; shift 2 ;;
        --public-url) PUBLIC_URL="${2:-}"; shift 2 ;;
        *) echo "Foundry: unknown install option: $1" >&2; exit 1 ;;
    esac
done

[[ "${EUID}" -eq 0 ]] || { echo "Foundry: install.sh must run as root." >&2; exit 1; }
[[ -f "${ARCHIVE}" ]] || { echo "Foundry: --archive must reference a prebuilt Foundry single-host release ZIP." >&2; exit 1; }
for command in node npm unzip sha256sum curl openssl systemctl runuser useradd install sed unlink env; do
    command -v "${command}" >/dev/null || { echo "Foundry: required command is unavailable: ${command}" >&2; exit 1; }
done
NODE_BINARY="$(readlink -f "$(command -v node)")"
NODE_MAJOR="$("${NODE_BINARY}" -p "Number(process.versions.node.split('.')[0])")"
[[ "${NODE_MAJOR}" =~ ^[0-9]+$ && "${NODE_MAJOR}" -ge 22 ]] || { echo "Foundry: Node.js 22 or newer is required." >&2; exit 1; }
PUBLIC_ORIGIN="$("${NODE_BINARY}" -e '
const value = process.argv[1];
const url = new URL(value);
if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") process.exit(2);
process.stdout.write(url.origin);
' "${PUBLIC_URL}")" || { echo "Foundry: --public-url must be an HTTPS origin without path, credentials, query, or fragment." >&2; exit 1; }
PUBLIC_HOSTNAME="$("${NODE_BINARY}" -e 'process.stdout.write(new URL(process.argv[1]).hostname)' "${PUBLIC_ORIGIN}")"

if ! getent passwd foundry >/dev/null; then
    useradd --system --home-dir /var/lib/foundry --shell /usr/sbin/nologin --user-group foundry
fi
runuser --user foundry -- "${NODE_BINARY}" --version >/dev/null \
    || { echo "Foundry: the foundry service account cannot execute ${NODE_BINARY}; install a system-wide Node.js 22+ binary." >&2; exit 1; }

install -d -o root -g foundry -m 0750 /opt/foundry /opt/foundry/releases
install -d -o foundry -g foundry -m 0750 /var/lib/foundry /var/lib/foundry/objects /var/lib/foundry/objects/.tmp /var/lib/foundry/backups
install -d -o root -g foundry -m 0750 /etc/foundry
install -d -o foundry -g foundry -m 0750 /var/cache/foundry /var/cache/foundry/npm
install -d -o root -g root -m 0755 /usr/local/lib/foundry /usr/local/sbin

ENVIRONMENT_FILE=/etc/foundry/foundry.env
if [[ ! -e "${ENVIRONMENT_FILE}" ]]; then
    SESSION_SECRET="$(openssl rand -hex 48)"
    STORAGE_SECRET="$(openssl rand -hex 48)"
    umask 0027
    {
        printf '%s\n' \
            'NODE_ENV=production' \
            'FOUNDRY_DEPLOYMENT_MODE=single-host' \
            "PLATFORM_PUBLIC_BASE_URL=${PUBLIC_ORIGIN}" \
            'HOST=127.0.0.1' \
            'PORT=3000' \
            'TRUST_PROXY_HOPS=1' \
            'ENABLE_HSTS=false' \
            'CORS_ALLOWED_ORIGINS=' \
            'FOUNDRY_DATA_DIR=/var/lib/foundry' \
            'PLATFORM_DB_PATH=/var/lib/foundry/platform.db' \
            "LOCAL_AUTH_SESSION_SECRET=${SESSION_SECRET}" \
            'LOCAL_AUTH_SESSION_TTL_SECONDS=604800' \
            "LOCAL_STORAGE_SIGNING_SECRET=${STORAGE_SECRET}" \
            'LOCAL_STORAGE_UPLOAD_URL_TTL_SECONDS=900' \
            'JOB_MODE=async' \
            'JOB_WORKER_ID=foundry-single-host-1' \
            'JOB_LEASE_MS=60000' \
            'MAX_JOB_ATTEMPTS=3' \
            'MAX_PUBLISH_ATTEMPTS=3' \
            'UPLOAD_CLEANUP_INTERVAL_MS=900000' \
            'UPLOAD_SESSION_EXPIRATION_MS=86400000' \
            'COMPLETED_UPLOAD_RETENTION_MS=604800000' \
            'SHUTDOWN_GRACE_MS=30000' \
            'E2E_MODE=false' \
            'SINGLE_HOST_TEST_MODE=false' \
            'LOCAL_DEV_MODE=false' \
            'AUTH_DEV_BYPASS=false' \
            'ALLOW_UNREADY_STARTUP=false' \
            'LOG_LEVEL=info' \
            'PLATFORM_MAX_STORAGE_BYTES_PER_USER=1073741824' \
            'PLATFORM_MAX_ACTIVE_UPLOADS_PER_USER=10' \
            'PLATFORM_MAX_GAME_VERSIONS_PER_USER=100' \
            'PLATFORM_MAX_PACKAGE_SIZE_BYTES=52428800' \
            'PLATFORM_MAX_FILES_PER_PACKAGE=1000' \
            'PLATFORM_MAX_EXTRACTED_FILES_PER_PACKAGE=1000' \
            'PLATFORM_MAX_TOTAL_EXTRACTED_SIZE_BYTES=104857600' \
            'PLATFORM_MAX_FILE_SIZE_BYTES=20971520' \
            'FOUNDRY_MIN_FREE_BYTES=1073741824'
    } > "${ENVIRONMENT_FILE}"
    chown root:foundry "${ENVIRONMENT_FILE}"
    chmod 0640 "${ENVIRONMENT_FILE}"
else
    echo "Foundry: preserving existing ${ENVIRONMENT_FILE}."
fi

install -o root -g root -m 0755 "${SCRIPT_DIRECTORY}/common.sh" /usr/local/lib/foundry/common.sh
install -o root -g root -m 0755 "${SCRIPT_DIRECTORY}/update.sh" /usr/local/lib/foundry/update.sh
install -o root -g root -m 0755 "${SCRIPT_DIRECTORY}/rollback.sh" /usr/local/lib/foundry/rollback.sh
install -o root -g root -m 0755 "${SCRIPT_DIRECTORY}/foundry" /usr/local/lib/foundry/foundry
install -o root -g root -m 0755 "${SCRIPT_DIRECTORY}/configure-deploy-user.sh" /usr/local/lib/foundry/configure-deploy-user.sh
install -o root -g root -m 0755 "${SCRIPT_DIRECTORY}/ci-update.sh" /usr/local/lib/foundry/ci-update.sh
install -o root -g root -m 0644 "${SCRIPT_DIRECTORY}/release-manifest.mjs" /usr/local/lib/foundry/release-manifest.mjs
ln -sfn /usr/local/lib/foundry/foundry /usr/local/sbin/foundry

UNIT_TEMP="$(mktemp /tmp/foundry.service.XXXXXX)"
trap 'rm -f "${UNIT_TEMP}"' EXIT
sed "s|@NODE_BINARY@|${NODE_BINARY}|g" "${SCRIPT_DIRECTORY}/foundry.service.in" > "${UNIT_TEMP}"
install -o root -g root -m 0644 "${UNIT_TEMP}" /etc/systemd/system/foundry.service
install -d -o root -g root -m 0755 /etc/systemd/system/caddy.service.d
install -o root -g root -m 0644 "${SCRIPT_DIRECTORY}/caddy-logging.conf" \
    /etc/systemd/system/caddy.service.d/10-foundry-logging.conf
sed "s|foundry\.example\.com|${PUBLIC_HOSTNAME}|g" "${SCRIPT_DIRECTORY}/Caddyfile.example" > /etc/foundry/Caddyfile
chown root:root /etc/foundry/Caddyfile
chmod 0644 /etc/foundry/Caddyfile
systemctl daemon-reload
systemctl enable foundry.service

source /usr/local/lib/foundry/common.sh
foundry_inspect_release_link "${FOUNDRY_CURRENT_LINK}" current
if [[ "${FOUNDRY_LINK_STATE}" == valid ]]; then
    /usr/local/lib/foundry/update.sh "$(readlink -f "${ARCHIVE}")"
else
    /usr/local/lib/foundry/update.sh "$(readlink -f "${ARCHIVE}")" --initial
fi

echo "Foundry: single-host installation is ready on 127.0.0.1:3000."
echo "Foundry: install Caddy, review /etc/foundry/Caddyfile, point DNS for ${PUBLIC_HOSTNAME}, and reload Caddy."
echo "Foundry: systemd will provision Caddy's private /var/log/caddy directory on service start."
echo "Foundry: after HTTPS is verified, set ENABLE_HSTS=true in ${ENVIRONMENT_FILE} and run 'systemctl restart foundry'."
echo "Foundry: run 'foundry doctor', then create the first operator with 'foundry create-user ... --password-stdin'."
