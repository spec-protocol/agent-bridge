# shellcheck shell=bash

os_name() {
  uname -s
}

is_darwin() {
  [[ "$(uname -s)" == Darwin ]]
}

is_linux() {
  [[ "$(uname -s)" == Linux ]]
}
