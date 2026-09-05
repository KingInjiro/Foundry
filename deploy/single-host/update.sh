#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIRECTORY}/common.sh"

foundry_require_root

ARCHIVE="${1:-}"
INITIAL_INSTALL=false
if [[ "${2:-}" == "--initial" || "${1:-}" == "--initial" ]]; then
    INITIAL_INSTALL=true
    [[ "${1:-}" == "--initial" ]] && ARCHIVE="${2:-}"
fi
[[ -n "${ARCHIVE}" ]] || foundry_fail "usage: foundry-update /absolute/path/Foundry.zip [--initial]"
ARCHIVE="$(readlink -f "${ARCHIVE}")"
[[ -f "${ARCHIVE}" ]] || foundry_fail "release archive does not exist: ${ARCHIVE}"
[[ "${ARCHIVE}" == *.zip ]] || foundry_fail "release archive must be a .zip file."

for command in node npm unzip sha256sum curl runuser systemctl unlink; do
    command -v "${command}" >/dev/null || foundry_fail "required command is unavailable: ${command}"
done
NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
[[ "${NODE_MAJOR}" =~ ^[0-9]+$ && "${NODE_MAJOR}" -ge 22 ]] || foundry_fail "Node.js 22 or newer is required."

ARCHIVE_BYTES="$(stat -c '%s' "${ARCHIVE}")"
[[ "${ARCHIVE_BYTES}" -le 2147483648 ]] || foundry_fail "release archive exceeds the 2 GiB safety limit."
ENTRY_COUNT="$(unzip -Z1 "${ARCHIVE}" | wc -l)"
[[ "${ENTRY_COUNT}" -gt 0 && "${ENTRY_COUNT}" -le 100000 ]] || foundry_fail "release archive entry count is outside the allowed range."
UNCOMPRESSED_BYTES="$(unzip -l "${ARCHIVE}" | tail -n 1 | awk '{print $1}')"
[[ "${UNCOMPRESSED_BYTES}" =~ ^[0-9]+$ && "${UNCOMPRESSED_BYTES}" -le 5368709120 ]] || foundry_fail "release archive exceeds the 5 GiB extracted-size safety limit."
if unzip -Z1 "${ARCHIVE}" | grep -Eq '(^/|(^|/)\.\.(/|$)|\\)'; then
    foundry_fail "release archive contains an unsafe path."
fi

mkdir -p "${FOUNDRY_RELEASES_DIR}"
SERVICE_ACTIVE_AT_PREFLIGHT=false
if systemctl is-active --quiet "${FOUNDRY_SERVICE_NAME}"; then SERVICE_ACTIVE_AT_PREFLIGHT=true; fi
foundry_prepare_release_links "${INITIAL_INSTALL}" "${SERVICE_ACTIVE_AT_PREFLIGHT}"

ARCHIVE_SHA="$(sha256sum "${ARCHIVE}" | awk '{print $1}')"
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-${ARCHIVE_SHA:0:12}"
RELEASE_DIRECTORY="${FOUNDRY_RELEASES_DIR}/${RELEASE_ID}"
[[ ! -e "${RELEASE_DIRECTORY}" ]] || foundry_fail "release already exists: ${RELEASE_DIRECTORY}"
STAGING_DIRECTORY="$(mktemp -d "${FOUNDRY_RELEASES_DIR}/.extract-${RELEASE_ID}.XXXXXX")"
RELEASE_COMMITTED=false
CURRENT_SWITCHED=false
OLD_RELEASE=""
SERVICE_WAS_ACTIVE=false

cleanup_staging() {
    local exit_status=$?
    local release_is_referenced=false
    trap - EXIT
    set +e
    if [[ -n "${STAGING_DIRECTORY:-}" && "${STAGING_DIRECTORY}" == "${FOUNDRY_RELEASES_DIR}/.extract-"* ]]; then
        rm -rf -- "${STAGING_DIRECTORY}"
    fi
    if [[ "${RELEASE_COMMITTED:-false}" != true && "${CURRENT_SWITCHED:-false}" == true \
        && -n "${RELEASE_DIRECTORY:-}" ]] \
        && foundry_link_points_to "${FOUNDRY_CURRENT_LINK}" "${RELEASE_DIRECTORY}"; then
        systemctl stop "${FOUNDRY_SERVICE_NAME}" >/dev/null 2>&1 || true
        if [[ -n "${OLD_RELEASE:-}" ]]; then
            if [[ -f "${OLD_RELEASE}/apps/platform/dist/server.cjs" \
                && -f "${OLD_RELEASE}/apps/platform/dist/server-profile.json" ]]; then
                if foundry_atomic_link "${OLD_RELEASE}" "${FOUNDRY_CURRENT_LINK}"; then
                    CURRENT_SWITCHED=false
                    if [[ "${SERVICE_WAS_ACTIVE:-false}" == true ]]; then
                        systemctl start "${FOUNDRY_SERVICE_NAME}" >/dev/null 2>&1 \
                            || echo "Foundry: warning: previous release link was restored but its service could not be restarted." >&2
                    fi
                fi
            else
                echo "Foundry: retaining failed release because the former current release is no longer safe to restore." >&2
            fi
        elif foundry_unlink_release_link_if_target "${FOUNDRY_CURRENT_LINK}" "${RELEASE_DIRECTORY}"; then
            CURRENT_SWITCHED=false
        fi
    fi
    if [[ "${RELEASE_COMMITTED:-false}" != true && -n "${RELEASE_DIRECTORY:-}" && "${RELEASE_DIRECTORY}" == "${FOUNDRY_RELEASES_DIR}/"* ]]; then
        if foundry_link_points_to "${FOUNDRY_CURRENT_LINK}" "${RELEASE_DIRECTORY}" \
            || foundry_link_points_to "${FOUNDRY_PREVIOUS_LINK}" "${RELEASE_DIRECTORY}"; then
            release_is_referenced=true
            echo "Foundry: retaining failed release because a deployment link still references it: ${RELEASE_DIRECTORY}" >&2
        fi
        [[ "${release_is_referenced}" == true ]] || rm -rf -- "${RELEASE_DIRECTORY}"
    fi
    exit "${exit_status}"
}
trap cleanup_staging EXIT

unzip -q "${ARCHIVE}" -d "${STAGING_DIRECTORY}"
if [[ -n "$(find "${STAGING_DIRECTORY}" -type l -print -quit)" ]]; then
    foundry_fail "release archive may not contain symbolic links."
fi
if [[ -n "$(find "${STAGING_DIRECTORY}" \( -type b -o -type c -o -type p -o -type s \) -print -quit)" ]]; then
    foundry_fail "release archive may contain only directories and regular files."
fi

SOURCE_ROOT="${STAGING_DIRECTORY}"
if [[ ! -f "${SOURCE_ROOT}/package.json" ]]; then
    shopt -s nullglob dotglob
    TOP_LEVEL=("${STAGING_DIRECTORY}"/*)
    shopt -u nullglob dotglob
    [[ "${#TOP_LEVEL[@]}" -eq 1 && -d "${TOP_LEVEL[0]}" && -f "${TOP_LEVEL[0]}/package.json" ]] \
        || foundry_fail "archive must contain the Foundry repository at its root or in one top-level directory."
    SOURCE_ROOT="${TOP_LEVEL[0]}"
fi
for required in \
    foundry-release.json \
    package-lock.json \
    apps/platform/package.json \
    apps/platform/dist/server.cjs \
    apps/platform/dist/client/deployment-profile.json \
    deploy/single-host/release-manifest.mjs; do
    [[ -f "${SOURCE_ROOT}/${required}" ]] || foundry_fail "release archive is missing ${required}."
done
if find "${SOURCE_ROOT}" -type f \( \( \( -name '.env' -o -name '.env.*' \) ! -name '.env.example' \) -o -name '*.db' -o -name '*.sqlite' -o -name '*.sqlite-wal' -o -name '*.sqlite-shm' \) -print -quit | grep -q .; then
    foundry_fail "release archive contains an environment file or database."
fi
[[ ! -d "${SOURCE_ROOT}/node_modules" ]] || foundry_fail "release archive must not contain node_modules."
env -u NODE_OPTIONS node "${SCRIPT_DIRECTORY}/release-manifest.mjs" "${SOURCE_ROOT}"

mv "${SOURCE_ROOT}" "${RELEASE_DIRECTORY}"
if [[ "${SOURCE_ROOT}" != "${STAGING_DIRECTORY}" ]]; then rmdir "${STAGING_DIRECTORY}"; fi
STAGING_DIRECTORY=""
chown -R "${FOUNDRY_SERVICE_USER}:${FOUNDRY_SERVICE_GROUP}" "${RELEASE_DIRECTORY}"
mkdir -p "${FOUNDRY_NPM_CACHE}"
chown "${FOUNDRY_SERVICE_USER}:${FOUNDRY_SERVICE_GROUP}" "${FOUNDRY_NPM_CACHE}"

echo "Foundry: installing production dependencies and validating prebuilt release ${RELEASE_ID} while the current service remains online."
foundry_run_as_service env \
    -u NODE_ENV -u NODE_OPTIONS -u FOUNDRY_DEPLOYMENT_MODE -u E2E_MODE -u SINGLE_HOST_TEST_MODE -u LOCAL_DEV_MODE -u AUTH_DEV_BYPASS \
    npm_config_cache="${FOUNDRY_NPM_CACHE}" \
    npm ci --omit=dev --prefix "${RELEASE_DIRECTORY}"
foundry_run_as_service env \
    -u NODE_ENV -u NODE_OPTIONS -u FOUNDRY_DEPLOYMENT_MODE -u E2E_MODE -u SINGLE_HOST_TEST_MODE -u LOCAL_DEV_MODE -u AUTH_DEV_BYPASS \
    node "${SCRIPT_DIRECTORY}/release-manifest.mjs" "${RELEASE_DIRECTORY}"
foundry_run_as_service env \
    -u NODE_ENV -u NODE_OPTIONS -u FOUNDRY_DEPLOYMENT_MODE -u E2E_MODE -u SINGLE_HOST_TEST_MODE -u LOCAL_DEV_MODE -u AUTH_DEV_BYPASS \
    node "${RELEASE_DIRECTORY}/apps/platform/scripts/verify-artifact.mjs"
foundry_run_as_service env \
    -u NODE_ENV -u NODE_OPTIONS -u FOUNDRY_DEPLOYMENT_MODE -u E2E_MODE -u SINGLE_HOST_TEST_MODE -u LOCAL_DEV_MODE -u AUTH_DEV_BYPASS \
    node "${RELEASE_DIRECTORY}/apps/platform/scripts/smoke-production.mjs"
foundry_finalize_release_permissions "${RELEASE_DIRECTORY}"
foundry_verify_release_access "${RELEASE_DIRECTORY}"

foundry_load_environment
SERVICE_WAS_ACTIVE=false
if systemctl is-active --quiet "${FOUNDRY_SERVICE_NAME}"; then SERVICE_WAS_ACTIVE=true; fi
foundry_prepare_release_links "${INITIAL_INSTALL}" "${SERVICE_WAS_ACTIVE}"
OLD_RELEASE="${FOUNDRY_CURRENT_RELEASE}"
if [[ -n "${OLD_RELEASE}" ]]; then
    systemctl stop "${FOUNDRY_SERVICE_NAME}"
    if [[ -f "${PLATFORM_DB_PATH}" ]]; then
        BACKUP_DIRECTORY="${FOUNDRY_DATA_DIR}/backups/foundry-backup-pre-update-${RELEASE_ID}"
        if ! foundry_run_as_service env FOUNDRY_RELEASE_ID="$(basename "${OLD_RELEASE}")" \
            node "${RELEASE_DIRECTORY}/apps/platform/scripts/single-host-backup.mjs" \
            --output "${BACKUP_DIRECTORY}" --confirm-service-stopped; then
            [[ "${SERVICE_WAS_ACTIVE}" == true ]] && systemctl start "${FOUNDRY_SERVICE_NAME}"
            foundry_fail "pre-update backup failed; the previous release was restarted."
        fi
    fi
    foundry_atomic_link "${OLD_RELEASE}" "${FOUNDRY_PREVIOUS_LINK}"
fi

foundry_atomic_link "${RELEASE_DIRECTORY}" "${FOUNDRY_CURRENT_LINK}"
CURRENT_SWITCHED=true
systemctl start "${FOUNDRY_SERVICE_NAME}"
if ! foundry_wait_ready 60; then
    systemctl stop "${FOUNDRY_SERVICE_NAME}" || true
    if [[ -n "${OLD_RELEASE}" ]] && foundry_check_release_compatibility "${OLD_RELEASE}" >/dev/null; then
        foundry_atomic_link "${OLD_RELEASE}" "${FOUNDRY_CURRENT_LINK}"
        CURRENT_SWITCHED=false
        systemctl start "${FOUNDRY_SERVICE_NAME}"
        foundry_wait_ready 60 || foundry_fail "new release failed and the compatible previous release did not recover readiness."
        foundry_fail "new release failed readiness; application symlink rolled back to ${OLD_RELEASE}."
    fi
    foundry_fail "new release failed readiness and automatic rollback is unsafe or unavailable; service remains stopped."
fi
RELEASE_COMMITTED=true
CURRENT_SWITCHED=false

RETENTION="${FOUNDRY_RELEASE_RETENTION:-3}"
[[ "${RETENTION}" =~ ^[0-9]+$ && "${RETENTION}" -ge 2 && "${RETENTION}" -le 10 ]] || RETENTION=3
foundry_inspect_release_link "${FOUNDRY_CURRENT_LINK}" current
[[ "${FOUNDRY_LINK_STATE}" == valid ]] || foundry_fail "successful activation did not leave a valid current release."
CURRENT_REAL="${FOUNDRY_LINK_TARGET}"
foundry_inspect_release_link "${FOUNDRY_PREVIOUS_LINK}" previous
[[ "${FOUNDRY_LINK_STATE}" != dangling ]] || foundry_fail "successful activation left a dangling previous release link."
PREVIOUS_REAL=""
if [[ "${FOUNDRY_LINK_STATE}" == valid ]]; then PREVIOUS_REAL="${FOUNDRY_LINK_TARGET}"; fi
mapfile -t RELEASES_BY_AGE < <(find "${FOUNDRY_RELEASES_DIR}" -mindepth 1 -maxdepth 1 -type d ! -name '.extract-*' -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-)
ADDITIONAL_TO_KEEP=$((RETENTION - 2))
ADDITIONAL_KEPT=0
for candidate in "${RELEASES_BY_AGE[@]}"; do
    candidate="$(readlink -f "${candidate}")"
    [[ "${candidate}" == "${FOUNDRY_RELEASES_DIR}/"* ]] || continue
    if [[ "${candidate}" == "${CURRENT_REAL}" || "${candidate}" == "${PREVIOUS_REAL}" ]]; then
        continue
    fi
    if [[ "${ADDITIONAL_KEPT}" -lt "${ADDITIONAL_TO_KEEP}" ]]; then
        ADDITIONAL_KEPT=$((ADDITIONAL_KEPT + 1))
        continue
    fi
    rm -rf -- "${candidate}"
done

echo "Foundry: release ${RELEASE_ID} is active and ready."
