#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
node_version_file="${project_root}/.nvmrc"

if [[ ! -f "${node_version_file}" ]]; then
  echo "Не найден файл ${node_version_file}." >&2
  exit 1
fi

required_version="$(tr -d '[:space:]' < "${node_version_file}")"
required_version="${required_version#v}"

version_is_supported() {
  local version="${1#v}"
  local major minor
  IFS='.' read -r major minor _ <<< "${version}"

  [[ "${major}" =~ ^[0-9]+$ ]] || return 1
  [[ "${minor}" =~ ^[0-9]+$ ]] || return 1
  (( major > 22 || (major == 22 && minor >= 12) ))
}

node_executable="$(command -v node || true)"
current_version=""

if [[ -n "${node_executable}" ]]; then
  current_version="$(${node_executable} --version)"
fi

if ! version_is_supported "${current_version}"; then
  nvm_directory="${NVM_DIR:-}"
  if [[ -z "${nvm_directory}" && -n "${HOME:-}" ]]; then
    nvm_directory="${HOME}/.nvm"
  fi

  nvm_node="${nvm_directory}/versions/node/v${required_version}/bin/node"
  if [[ ! -x "${nvm_node}" ]]; then
    echo "Для Extension.js нужен Node.js >= 22.12." >&2
    echo "Установите версию из .nvmrc: nvm install ${required_version}" >&2
    exit 1
  fi

  echo "Используется Node.js ${required_version} из .nvmrc (текущий: ${current_version:-не найден})." >&2
  node_executable="${nvm_node}"
fi

if [[ $# -lt 1 ]]; then
  echo "Не указан запускаемый Node.js-скрипт." >&2
  exit 1
fi

tool_path="$1"
shift

exec "${node_executable}" "${project_root}/${tool_path}" "$@"
