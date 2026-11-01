# shellcheck shell=bash
# Linux: sed -i. macOS: sed -i ''.

sed_inplace() {
  if [[ "$(uname -s)" == Darwin ]]; then
    sed -i '' "$@"
  else
    sed -i "$@"
  fi
}
