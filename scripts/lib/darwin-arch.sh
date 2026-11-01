# shellcheck shell=bash
# Native macOS architecture. Do not use on Linux.

darwin_machine() {
  uname -m
}

darwin_asset_arch() {
  case "$(uname -m)" in
    arm64) printf '%s' arm64 ;;
    x86_64) printf '%s' amd64 ;;
    *)
      echo "Error: unsupported macOS architecture: $(uname -m)" >&2
      return 1
      ;;
  esac
}

darwin_node_arch() {
  case "$(uname -m)" in
    arm64) printf '%s' arm64 ;;
    x86_64) printf '%s' x64 ;;
    *) return 1 ;;
  esac
}

darwin_brew_prefix() {
  case "$(uname -m)" in
    arm64) printf '%s' /opt/homebrew ;;
    x86_64) printf '%s' /usr/local ;;
    *) return 1 ;;
  esac
}

darwin_other_prefix() {
  case "$(uname -m)" in
    arm64) printf '%s' /usr/local ;;
    x86_64) printf '%s' /opt/homebrew ;;
    *) return 1 ;;
  esac
}

darwin_service_path() {
  printf '%s' "$(darwin_brew_prefix)/bin:$(darwin_other_prefix)/bin:${HOME}/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
}

# 0 when the binary is native, universal, or a script (the wrapper picks the architecture).
darwin_binary_ok() {
  local bin="$1" info machine
  [[ -n "$bin" && -x "$bin" ]] || return 1
  info="$(file -b "$bin" 2>/dev/null || true)"
  case "$info" in
    *text*|*script*|*ASCII*|*JSON*) return 0 ;;
    *universal*) return 0 ;;
  esac
  machine="$(uname -m)"
  if [[ "$machine" == arm64 && "$info" == *arm64* ]]; then
    return 0
  fi
  if [[ "$machine" == x86_64 && "$info" == *x86_64* ]]; then
    return 0
  fi
  return 1
}

darwin_native_node() {
  local prefix want c arch
  prefix="$(darwin_brew_prefix)"
  want="$(darwin_node_arch)" || return 1
  for c in "${prefix}/bin/node" "$(command -v node 2>/dev/null || true)" "${HOME}/.local/bin/node"; do
    [[ -n "$c" && -x "$c" ]] || continue
    arch="$("$c" -p "process.arch" 2>/dev/null || true)"
    if [[ "$arch" == "$want" ]]; then
      printf '%s' "$c"
      return 0
    fi
  done
  echo "Error: native node (${want}) not found. The node on PATH is another architecture." >&2
  return 1
}

ensure_cloudflared() {
  local prefix other c brew asset dest tmp found
  prefix="$(darwin_brew_prefix)" || return 1
  other="$(darwin_other_prefix)" || return 1
  for c in \
    "${prefix}/bin/cloudflared" \
    "${HOME}/.local/bin/cloudflared" \
    "${other}/bin/cloudflared" \
    /usr/bin/cloudflared
  do
    if darwin_binary_ok "$c"; then
      printf '%s' "$c"
      return 0
    fi
  done

  brew="${prefix}/bin/brew"
  if [[ -x "$brew" ]]; then
    echo "Instalando cloudflared com Homebrew (${brew})..." >&2
    if "$brew" install cloudflared >&2; then
      if darwin_binary_ok "${prefix}/bin/cloudflared"; then
        printf '%s' "${prefix}/bin/cloudflared"
        return 0
      fi
    fi
  fi

  asset="cloudflared-darwin-$(darwin_asset_arch).tgz" || return 1
  dest="${HOME}/.local/bin/cloudflared"
  mkdir -p "${HOME}/.local/bin"
  tmp="$(mktemp -d)"
  echo "Baixando ${asset}..." >&2
  if ! curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}" -o "${tmp}/cf.tgz"; then
    rm -rf "$tmp"
    echo "Error: could not download ${asset}." >&2
    return 1
  fi
  tar -xzf "${tmp}/cf.tgz" -C "$tmp"
  found="$(find "$tmp" -type f -name cloudflared | head -1)"
  if [[ -z "$found" ]]; then
    rm -rf "$tmp"
    echo "Error: the ${asset} package does not contain the cloudflared binary." >&2
    return 1
  fi
  mv "$found" "$dest"
  chmod +x "$dest"
  rm -rf "$tmp"
  if darwin_binary_ok "$dest"; then
    printf '%s' "$dest"
    return 0
  fi
  echo "Error: cloudflared at ${dest} is not native to $(uname -m)." >&2
  return 1
}
