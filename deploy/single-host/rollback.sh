#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIRECTORY}/common.sh"

foundry_require_root
foundry_load_environment

foundry_require_current_release
CURRENT_RELEASE="${FOUNDRY_CURRENT_RELEASE}"
if [[ "${1:-}" == "--release" ]]; then
    [[ -n "${2:-}" && "${2}" != */* ]] || foundry_fail "--release expects one release directory name."
    TARGET_RELEASE="${FOUNDRY_RELEASES_DIR}/${2}"
else
    foundry_inspect_release_link "${FOUNDRY_PREVIOUS_LINK}" previous
    case "${FOUNDRY_LINK_STATE}" in
        absent) foundry_fail "no previous release is recorded." ;;
        dangling) foundry_fail "previous deployment link is dangling: ${FOUNDRY_PREVIOUS_LINK} -> ${FOUNDRY_LINK_TARGET}" ;;
        valid) TARGET_RELEASE="${FOUNDRY_LINK_TARGET}" ;;
    esac
fi
TARGET_RELEASE="$(foundry_validate_release_path "${TARGET_RELEASE}")"
[[ "${TARGET_RELEASE}" != "${CURRENT_RELEASE}" ]] || foundry_fail "target release is already active."

# This is deliberately conservative. Foundry never attempts a down migration.
foundry_check_release_compatibility "${TARGET_RELEASE}" >/dev/null \
    || foundry_fail "rollback stopped because the target release does not support the current DB migration."

systemctl stop "${FOUNDRY_SERVICE_NAME}"
if [[ -f "${PLATFORM_DB_PATH}" ]]; then
    ROLLBACK_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(basename "${TARGET_RELEASE}")"
    BACKUP_DIRECTORY="${FOUNDRY_DATA_DIR}/backups/foundry-backup-pre-rollback-${ROLLBACK_ID}"
    if ! foundry_run_as_service env FOUNDRY_RELEASE_ID="$(basename "${CURRENT_RELEASE}")" \
        node "${CURRENT_RELEASE}/apps/platform/scripts/single-host-backup.mjs" \
        --output "${BACKUP_DIRECTORY}" --confirm-service-stopped; then
        systemctl start "${FOUNDRY_SERVICE_NAME}"
        foundry_wait_ready 60 || true
        foundry_fail "pre-rollback backup failed; current release was restarted."
    fi
fi

foundry_atomic_link "${CURRENT_RELEASE}" "${FOUNDRY_PREVIOUS_LINK}"
foundry_atomic_link "${TARGET_RELEASE}" "${FOUNDRY_CURRENT_LINK}"
systemctl start "${FOUNDRY_SERVICE_NAME}"
if ! foundry_wait_ready 60; then
    systemctl stop "${FOUNDRY_SERVICE_NAME}" || true
    foundry_atomic_link "${CURRENT_RELEASE}" "${FOUNDRY_CURRENT_LINK}"
    systemctl start "${FOUNDRY_SERVICE_NAME}"
    foundry_wait_ready 60 || foundry_fail "rollback failed and the original release did not recover readiness."
    foundry_fail "rollback target failed readiness; original application release restored."
fi

echo "Foundry: application rollback complete: $(basename "${CURRENT_RELEASE}") -> $(basename "${TARGET_RELEASE}")."
echo "Foundry: database schema was not downgraded."
