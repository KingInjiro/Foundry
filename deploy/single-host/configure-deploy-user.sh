#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIRECTORY}/common.sh"

foundry_require_root

DEPLOY_USER="${1:-}"
[[ "$#" -eq 1 && "${DEPLOY_USER}" =~ ^[a-z_][a-z0-9_-]*$ ]] \
    || foundry_fail "usage: foundry configure-deploy-user LINUX_USERNAME"
for command in getent id install mktemp visudo mv; do
    command -v "${command}" >/dev/null || foundry_fail "required command is unavailable: ${command}"
done

PASSWD_ENTRY="$(getent passwd "${DEPLOY_USER}")" \
    || foundry_fail "deployment user does not exist: ${DEPLOY_USER}"
IFS=: read -r _ _ DEPLOY_UID _ _ DEPLOY_HOME _ <<< "${PASSWD_ENTRY}"
[[ "${DEPLOY_UID}" =~ ^[0-9]+$ && "${DEPLOY_UID}" -ne 0 ]] \
    || foundry_fail "deployment user may not be root."
[[ "${DEPLOY_HOME}" =~ ^/[A-Za-z0-9._/-]+$ && "${DEPLOY_HOME}" != / && -d "${DEPLOY_HOME}" ]] \
    || foundry_fail "deployment user must have an existing, simple absolute home directory."
DEPLOY_GROUP="$(id -gn "${DEPLOY_USER}")" \
    || foundry_fail "deployment user's primary group cannot be resolved."

UPLOAD_DIRECTORY="${DEPLOY_HOME}/.foundry-deploy"
UPLOAD_ARCHIVE="${UPLOAD_DIRECTORY}/Foundry-single-host.zip"
install -d -o "${DEPLOY_USER}" -g "${DEPLOY_GROUP}" -m 0700 "${UPLOAD_DIRECTORY}"

SUDOERS_PATH="/etc/sudoers.d/foundry-deploy-${DEPLOY_USER}"
SUDOERS_TEMP="$(mktemp "/etc/sudoers.d/.foundry-deploy-${DEPLOY_USER}.XXXXXX")"
cleanup_sudoers_temp() { rm -f -- "${SUDOERS_TEMP}"; }
trap cleanup_sudoers_temp EXIT
printf '%s ALL=(root) NOPASSWD: /usr/local/lib/foundry/ci-update.sh\n' \
    "${DEPLOY_USER}" > "${SUDOERS_TEMP}"
chown root:root "${SUDOERS_TEMP}"
chmod 0440 "${SUDOERS_TEMP}"
visudo -cf "${SUDOERS_TEMP}" >/dev/null \
    || foundry_fail "generated deployment sudoers policy is invalid."
mv -f -- "${SUDOERS_TEMP}" "${SUDOERS_PATH}"
trap - EXIT

echo "Foundry: ${DEPLOY_USER} may deploy only ${UPLOAD_ARCHIVE} through the clean-environment update helper."
echo "Foundry: protect this account's SSH key and the GitHub production environment as production credentials."
