#!/usr/bin/env bash
set -Eeuo pipefail

FOUNDRY_INSTALL_ROOT="${FOUNDRY_INSTALL_ROOT:-/opt/foundry}"
FOUNDRY_RELEASES_DIR="${FOUNDRY_INSTALL_ROOT}/releases"
FOUNDRY_CURRENT_LINK="${FOUNDRY_INSTALL_ROOT}/current"
FOUNDRY_PREVIOUS_LINK="${FOUNDRY_INSTALL_ROOT}/previous"
FOUNDRY_ENV_FILE="${FOUNDRY_ENV_FILE:-/etc/foundry/foundry.env}"
FOUNDRY_SERVICE_NAME="${FOUNDRY_SERVICE_NAME:-foundry.service}"
FOUNDRY_SERVICE_USER="${FOUNDRY_SERVICE_USER:-foundry}"
FOUNDRY_SERVICE_GROUP="${FOUNDRY_SERVICE_GROUP:-${FOUNDRY_SERVICE_USER}}"
FOUNDRY_NPM_CACHE="${FOUNDRY_NPM_CACHE:-/var/cache/foundry/npm}"

foundry_fail() {
    echo "Foundry: $*" >&2
    exit 1
}

foundry_require_root() {
    [[ "${EUID}" -eq 0 ]] || foundry_fail "this command must run as root."
}

foundry_load_environment() {
    [[ -f "${FOUNDRY_ENV_FILE}" ]] || foundry_fail "missing protected environment file: ${FOUNDRY_ENV_FILE}"
    set -a
    # shellcheck disable=SC1090
    source "${FOUNDRY_ENV_FILE}"
    set +a
    [[ "${FOUNDRY_DEPLOYMENT_MODE:-}" == "single-host" ]] || foundry_fail "FOUNDRY_DEPLOYMENT_MODE must be single-host."
    [[ "${NODE_ENV:-}" == "production" ]] || foundry_fail "NODE_ENV must be production."
}

foundry_run_as_service() {
    runuser --preserve-environment --user "${FOUNDRY_SERVICE_USER}" -- "$@"
}

foundry_validate_release_path() {
    local candidate releases
    [[ -e "$1" ]] || foundry_fail "release path does not exist: $1"
    candidate="$(readlink -f -- "$1")" || foundry_fail "release path cannot be resolved: $1"
    releases="$(readlink -f -- "${FOUNDRY_RELEASES_DIR}")" \
        || foundry_fail "release directory cannot be resolved: ${FOUNDRY_RELEASES_DIR}"
    [[ "$(dirname -- "${candidate}")" == "${releases}" ]] \
        || foundry_fail "release path escapes ${FOUNDRY_RELEASES_DIR}: ${candidate}"
    [[ -f "${candidate}/apps/platform/dist/server.cjs" ]] || foundry_fail "release is missing dist/server.cjs: ${candidate}"
    [[ -f "${candidate}/apps/platform/dist/server-profile.json" ]] || foundry_fail "release is missing dist/server-profile.json: ${candidate}"
    printf '%s\n' "${candidate}"
}

foundry_resolve_link_target() {
    local link="$1"
    local raw_target
    raw_target="$(readlink -- "${link}")" || return 1
    [[ -n "${raw_target}" ]] || return 1
    if [[ "${raw_target}" == /* ]]; then
        readlink -m -- "${raw_target}"
    else
        readlink -m -- "$(dirname -- "${link}")/${raw_target}"
    fi
}

# Sets FOUNDRY_LINK_STATE to absent, dangling, or valid and FOUNDRY_LINK_TARGET
# to the canonical direct child of the releases directory for the latter two.
# Existing non-links, escaping links, and links to invalid releases fail closed.
foundry_inspect_release_link() {
    local link="$1"
    local label="$2"
    local candidate releases
    FOUNDRY_LINK_STATE=absent
    FOUNDRY_LINK_TARGET=""

    if [[ ! -L "${link}" ]]; then
        [[ ! -e "${link}" ]] \
            || foundry_fail "${label} deployment path exists but is not a symbolic link: ${link}"
        return 0
    fi

    candidate="$(foundry_resolve_link_target "${link}")" \
        || foundry_fail "${label} deployment link cannot be resolved: ${link}"
    releases="$(readlink -f -- "${FOUNDRY_RELEASES_DIR}")" \
        || foundry_fail "release directory cannot be resolved: ${FOUNDRY_RELEASES_DIR}"
    [[ "$(dirname -- "${candidate}")" == "${releases}" ]] \
        || foundry_fail "${label} deployment link escapes ${FOUNDRY_RELEASES_DIR}: ${link} -> ${candidate}"

    FOUNDRY_LINK_TARGET="${candidate}"
    if [[ ! -e "${candidate}" ]]; then
        FOUNDRY_LINK_STATE=dangling
        return 0
    fi
    [[ -d "${candidate}" ]] \
        || foundry_fail "${label} deployment link does not target a release directory: ${link} -> ${candidate}"
    foundry_validate_release_path "${candidate}" >/dev/null
    FOUNDRY_LINK_STATE=valid
}

foundry_link_points_to() {
    local link="$1"
    local expected="$2"
    local actual expected_canonical
    [[ -L "${link}" ]] || return 1
    actual="$(foundry_resolve_link_target "${link}")" || return 1
    expected_canonical="$(readlink -m -- "${expected}")" || return 1
    [[ "${actual}" == "${expected_canonical}" ]]
}

foundry_unlink_release_link_if_target() {
    local link="$1"
    local expected="$2"
    case "${link}" in
        "${FOUNDRY_CURRENT_LINK}"|"${FOUNDRY_PREVIOUS_LINK}") ;;
        *) foundry_fail "refusing to unlink an unmanaged deployment path: ${link}" ;;
    esac
    foundry_link_points_to "${link}" "${expected}" || return 1
    unlink -- "${link}"
    [[ ! -e "${link}" && ! -L "${link}" ]]
}

foundry_is_generated_release_path() {
    local candidate="$1"
    local releases
    releases="$(readlink -f -- "${FOUNDRY_RELEASES_DIR}")" || return 1
    [[ "$(dirname -- "${candidate}")" == "${releases}" ]] || return 1
    [[ "$(basename -- "${candidate}")" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$ ]]
}

# Captures a coherent current/previous state in FOUNDRY_CURRENT_RELEASE and
# FOUNDRY_PREVIOUS_RELEASE. During an inactive --initial installation only,
# provably generated dangling links under releases/ are safe to remove.
foundry_prepare_release_links() {
    local initial_install="$1"
    local service_active="$2"
    local current_state current_target previous_state previous_target
    FOUNDRY_CURRENT_RELEASE=""
    FOUNDRY_PREVIOUS_RELEASE=""

    foundry_inspect_release_link "${FOUNDRY_CURRENT_LINK}" current
    current_state="${FOUNDRY_LINK_STATE}"
    current_target="${FOUNDRY_LINK_TARGET}"
    foundry_inspect_release_link "${FOUNDRY_PREVIOUS_LINK}" previous
    previous_state="${FOUNDRY_LINK_STATE}"
    previous_target="${FOUNDRY_LINK_TARGET}"

    if [[ "${initial_install}" == true ]]; then
        [[ "${current_state}" != valid ]] \
            || foundry_fail "--initial is allowed only when no current release exists."
        [[ "${previous_state}" != valid ]] \
            || foundry_fail "--initial found a valid previous release without a current release; refusing to discard deployment history."
        if [[ "${current_state}" == dangling || "${previous_state}" == dangling ]]; then
            [[ "${service_active}" != true ]] \
                || foundry_fail "--initial cannot recover dangling deployment links while ${FOUNDRY_SERVICE_NAME} is active."
        fi
        if [[ "${current_state}" == dangling ]]; then
            foundry_is_generated_release_path "${current_target}" \
                || foundry_fail "current deployment link is dangling but is not a generated Foundry release: ${FOUNDRY_CURRENT_LINK} -> ${current_target}"
            foundry_unlink_release_link_if_target "${FOUNDRY_CURRENT_LINK}" "${current_target}" \
                || foundry_fail "current deployment link changed while recovering the failed initial installation."
            echo "Foundry: removed stale current link from failed initial release $(basename -- "${current_target}")."
        fi
        if [[ "${previous_state}" == dangling ]]; then
            foundry_is_generated_release_path "${previous_target}" \
                || foundry_fail "previous deployment link is dangling but is not a generated Foundry release: ${FOUNDRY_PREVIOUS_LINK} -> ${previous_target}"
            foundry_unlink_release_link_if_target "${FOUNDRY_PREVIOUS_LINK}" "${previous_target}" \
                || foundry_fail "previous deployment link changed while recovering the failed initial installation."
            echo "Foundry: removed stale previous link from failed initial deployment state."
        fi
        return 0
    fi

    [[ "${current_state}" != dangling ]] \
        || foundry_fail "current deployment link is dangling: ${FOUNDRY_CURRENT_LINK} -> ${current_target}"
    [[ "${previous_state}" != dangling ]] \
        || foundry_fail "previous deployment link is dangling: ${FOUNDRY_PREVIOUS_LINK} -> ${previous_target}"
    if [[ "${current_state}" == absent && "${previous_state}" == valid ]]; then
        foundry_fail "previous release exists without a current release; deployment state is incoherent."
    fi
    if [[ "${current_state}" == valid ]]; then FOUNDRY_CURRENT_RELEASE="${current_target}"; fi
    if [[ "${previous_state}" == valid ]]; then FOUNDRY_PREVIOUS_RELEASE="${previous_target}"; fi
    return 0
}

foundry_require_current_release() {
    foundry_inspect_release_link "${FOUNDRY_CURRENT_LINK}" current
    case "${FOUNDRY_LINK_STATE}" in
        absent) foundry_fail "no active release exists." ;;
        dangling) foundry_fail "current deployment link is dangling: ${FOUNDRY_CURRENT_LINK} -> ${FOUNDRY_LINK_TARGET}" ;;
        valid) FOUNDRY_CURRENT_RELEASE="${FOUNDRY_LINK_TARGET}" ;;
    esac
}

foundry_current_release() {
    foundry_require_current_release
    printf '%s\n' "${FOUNDRY_CURRENT_RELEASE}"
}

foundry_finalize_release_permissions() {
    local release
    release="$(foundry_validate_release_path "$1")"

    find "${release}" -xdev -type d -exec chmod 0750 {} +
    find "${release}" -xdev -type f -perm /111 -exec chmod 0750 {} +
    find "${release}" -xdev -type f ! -perm /111 -exec chmod 0640 {} +
    chown -R root:"${FOUNDRY_SERVICE_GROUP}" "${release}"
}

foundry_verify_release_access() {
    local release mismatch parent
    release="$(foundry_validate_release_path "$1")"

    [[ "${FOUNDRY_SERVICE_USER}" != root && "${FOUNDRY_SERVICE_USER}" != 0 ]] \
        || foundry_fail "the Foundry service account may not be root."
    for parent in "${FOUNDRY_INSTALL_ROOT}" "${FOUNDRY_RELEASES_DIR}"; do
        [[ "$(stat -c '%u:%G:%a' "${parent}")" == "0:${FOUNDRY_SERVICE_GROUP}:750" ]] \
            || foundry_fail "release parent must be root:${FOUNDRY_SERVICE_GROUP} with mode 0750: ${parent}"
    done
    mismatch="$(find "${release}" -xdev ! -user root -print -quit)"
    [[ -z "${mismatch}" ]] || foundry_fail "finalized release entry is not root-owned: ${mismatch}"
    mismatch="$(find "${release}" -xdev ! -group "${FOUNDRY_SERVICE_GROUP}" -print -quit)"
    [[ -z "${mismatch}" ]] || foundry_fail "finalized release entry has the wrong service group: ${mismatch}"
    mismatch="$(find "${release}" -xdev -type d ! -perm 0750 -print -quit)"
    [[ -z "${mismatch}" ]] || foundry_fail "finalized release directory mode is not 0750: ${mismatch}"
    mismatch="$(find "${release}" -xdev -type f ! \( -perm 0640 -o -perm 0750 \) -print -quit)"
    [[ -z "${mismatch}" ]] || foundry_fail "finalized release file mode is not 0640 or 0750: ${mismatch}"

    foundry_run_as_service env \
        -u NODE_OPTIONS \
        FOUNDRY_RELEASE_ACCESS_CHECK=1 \
        FOUNDRY_RELEASE_DIRECTORY="${release}" \
        "$(command -v node)" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const release = process.env.FOUNDRY_RELEASE_DIRECTORY;
const platform = path.join(release, 'apps', 'platform');
const serverBundle = path.join(platform, 'dist', 'server.cjs');
process.chdir(platform);
fs.accessSync(serverBundle, fs.constants.R_OK);
const runtimeRequire = createRequire(serverBundle);
for (const dependency of ['express', 'jszip']) {
    const resolved = runtimeRequire.resolve(dependency);
    fs.accessSync(resolved, fs.constants.R_OK);
}
if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    for (const immutablePath of [release, serverBundle]) {
        try {
            fs.accessSync(immutablePath, fs.constants.W_OK);
            throw new Error(`service account can write immutable release content: ${immutablePath}`);
        } catch (error) {
            if (error.code !== 'EACCES') throw error;
        }
    }
}
NODE
}

foundry_atomic_link() {
    local target="$1"
    local link="$2"
    local temporary="${link}.new.$$"
    rm -f "${temporary}"
    ln -s "${target}" "${temporary}"
    mv -Tf "${temporary}" "${link}"
}

foundry_wait_ready() {
    local attempts="${1:-60}"
    local port="${PORT:-3000}"
    local index
    for ((index = 0; index < attempts; index += 1)); do
        if curl --silent --show-error --fail --max-time 2 "http://127.0.0.1:${port}/api/ready" >/dev/null; then
            return 0
        fi
        sleep 1
    done
    return 1
}

foundry_check_release_compatibility() {
    local release="$1"
    case "${FOUNDRY_STORAGE_PROVIDER:-local-disk}" in
        local-disk) ;;
        r2)
            # This guard belongs to installed operator tooling: an old target
            # doctor knows only SQLite and must not approve a disk-only runtime.
            foundry_run_as_service "$(command -v node)" --input-type=module -e '
                import fs from "node:fs";
                import path from "node:path";
                const profile = JSON.parse(fs.readFileSync(path.join(process.argv[1], "apps/platform/dist/client/deployment-profile.json"), "utf8"));
                const supported = profile.supportedStorageProviders;
                if (profile.schemaVersion !== 2 || profile.deploymentMode !== "single-host" || profile.authProvider !== "local"
                    || profile.firebaseProjectId || profile.firebaseAuthDomain
                    || !Array.isArray(supported) || new Set(supported).size !== supported.length
                    || !supported.every(value => ["local-disk", "r2"].includes(value))
                    || !supported.includes(profile.storageProvider) || !supported.includes("r2")) {
                    throw new Error("Rollback is unsafe: target release does not support single-host R2 storage.");
                }
            ' "${release}" || return 1
            ;;
        *) echo 'Foundry: invalid FOUNDRY_STORAGE_PROVIDER.' >&2; return 1 ;;
    esac
    foundry_run_as_service \
        "$(command -v node)" \
        "${release}/apps/platform/scripts/single-host-doctor.mjs" \
        --check-release "${release}" \
        --db "${PLATFORM_DB_PATH}"
}
