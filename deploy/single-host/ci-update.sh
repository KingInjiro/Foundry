#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
    echo "Foundry: $*" >&2
    exit 1
}

[[ "$#" -eq 0 ]] || fail "the CI update helper does not accept arguments."
DEPLOY_USER="${SUDO_USER:-}"
[[ "${DEPLOY_USER}" =~ ^[a-z_][a-z0-9_-]*$ ]] \
    || fail "the CI update helper must be invoked through sudo by a configured non-root user."
PASSWD_ENTRY="$(getent passwd "${DEPLOY_USER}")" \
    || fail "deployment user does not exist: ${DEPLOY_USER}"
IFS=: read -r _ _ DEPLOY_UID _ _ DEPLOY_HOME _ <<< "${PASSWD_ENTRY}"
[[ "${DEPLOY_UID}" =~ ^[0-9]+$ && "${DEPLOY_UID}" -ne 0 && "${DEPLOY_UID}" == "${SUDO_UID:-}" ]] \
    || fail "sudo deployment identity is inconsistent."
[[ "${DEPLOY_HOME}" =~ ^/[A-Za-z0-9._/-]+$ && "${DEPLOY_HOME}" != / ]] \
    || fail "deployment user has an unsafe home directory."

UPLOAD_ARCHIVE="${DEPLOY_HOME}/.foundry-deploy/Foundry-single-host.zip"
[[ -f "${UPLOAD_ARCHIVE}" && ! -L "${UPLOAD_ARCHIVE}" ]] \
    || fail "fixed-path deployment archive is missing or is not a regular file: ${UPLOAD_ARCHIVE}"
[[ "$(stat -c '%U' "${UPLOAD_ARCHIVE}")" == "${DEPLOY_USER}" ]] \
    || fail "deployment archive must be owned by ${DEPLOY_USER}."
[[ -z "$(find "${UPLOAD_ARCHIVE}" -maxdepth 0 -perm /022 -print -quit)" ]] \
    || fail "deployment archive may not be group- or world-writable."

exec env -i \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    HOME=/root \
    /usr/local/lib/foundry/foundry update "${UPLOAD_ARCHIVE}"
