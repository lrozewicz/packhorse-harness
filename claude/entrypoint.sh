#!/usr/bin/env bash
# ============================================================================
#  Entrypoint of the Claude Code container.
#    1. installs the generated managed settings (/model entries for models from models.yaml),
#       the harness CLAUDE.md and - when HARNESS_INHERIT_HOST_CONFIG=1 - host permissions/env
#    2. waits for the router (Claude Code probes ANTHROPIC_BASE_URL on startup)
#    3. drops root, links the config layers (harness, image, host) into ~/.claude
#       and runs claude as the user with the host UID
#
#  Usage:   entrypoint.sh [claude arguments]    -> claude "$@"
#           entrypoint.sh bash|sh|shell         -> interactive shell
#           entrypoint.sh exec <cmd> [args]     -> arbitrary command
# ============================================================================
set -euo pipefail

USER_NAME="${HARNESS_USER:-claude}"
GENERATED="${HARNESS_GENERATED_DIR:-/harness/generated}"
MANAGED_DIR="/etc/claude-code/managed-settings.d"
MANAGED_FILE="${MANAGED_DIR}/10-harness-models.json"
HOST_SETTINGS_FILE="${MANAGED_DIR}/05-host-settings.json"
HARNESS_CONFIG="${HARNESS_CONFIG_DIR:-/harness/claude/config}"
HOST_CLAUDE="${HARNESS_HOST_CLAUDE_DIR:-/harness/host-claude}"

inherit_host() { [ "${HARNESS_INHERIT_HOST_CONFIG:-1}" = "1" ] && [ -d "$HOST_CLAUDE" ]; }

log() { printf 'harness: %s\n' "$*" >&2; }

# --- 1. managed settings ----------------------------------------------------
# Claude Code reads modelPicker only from managed / --settings / user settings.
# Writing to managed leaves ~/.claude/settings.json (which holds the login) untouched.
install_managed_settings() {
  mkdir -p "$MANAGED_DIR"
  if [ -r "${GENERATED}/managed-settings.json" ]; then
    install -o root -g root -m 0644 "${GENERATED}/managed-settings.json" "$MANAGED_FILE"
    log "managed settings: $(jq -c '.modelPicker.options | map(.model)' "$MANAGED_FILE" 2>/dev/null || echo '?')"
  else
    rm -f "$MANAGED_FILE"
    log "missing ${GENERATED}/managed-settings.json - run './bin/harness regen'"
  fi
}

# The harness CLAUDE.md goes into managed memory (/etc/claude-code/CLAUDE.md),
# so it does not compete with ~/.claude/CLAUDE.md - neither the volume's own nor the host's.
install_managed_memory() {
  if [ -r "${HARNESS_CONFIG}/CLAUDE.md" ]; then
    install -o root -g root -m 0644 "${HARNESS_CONFIG}/CLAUDE.md" /etc/claude-code/CLAUDE.md
  else
    rm -f /etc/claude-code/CLAUDE.md
  fi
}

# From the host settings.json we take only what makes sense in the container: permission
# rules and environment variables. model/hooks/autoMode/plugins point to host paths
# and host state. ANTHROPIC_*/CLAUDE_* variables are dropped - they would break routing.
# The 05-* drop-in loads before 10-harness-models.json, so the harness wins.
install_host_settings() {
  if inherit_host && [ -r "${HOST_CLAUDE}/settings.json" ]; then
    if jq '{
          permissions: ((.permissions // {}) | {allow, deny, ask} | with_entries(select(.value != null))),
          env: ((.env // {}) | with_entries(select(.key | test("^(ANTHROPIC_|CLAUDE_|PATH$|HOME$)") | not)))
        } | with_entries(select(.value != {}))' \
        "${HOST_CLAUDE}/settings.json" > "${HOST_SETTINGS_FILE}.tmp" 2>/dev/null; then
      install -o root -g root -m 0644 "${HOST_SETTINGS_FILE}.tmp" "$HOST_SETTINGS_FILE"
      log "host settings: $(jq -c '{allow: (.permissions.allow // [] | length), deny: (.permissions.deny // [] | length), env: (.env // {} | keys)}' "$HOST_SETTINGS_FILE")"
    else
      log "WARNING: could not read ${HOST_CLAUDE}/settings.json - skipping"
      rm -f "$HOST_SETTINGS_FILE"
    fi
    rm -f "${HOST_SETTINGS_FILE}.tmp"
  else
    rm -f "$HOST_SETTINGS_FILE"
  fi
}

# --- 2. the router must be up before Claude Code starts ---------------------
wait_for_router() {
  local url="${HARNESS_ROUTER_HEALTH:-}"
  [ -n "$url" ] || return 0
  local tries="${HARNESS_ROUTER_WAIT:-30}"
  for ((i = 1; i <= tries; i++)); do
    if curl -fsS -m 2 "$url" >/dev/null 2>&1; then
      [ "$i" -gt 1 ] && log "router ready after ${i}s"
      return 0
    fi
    sleep 1
  done
  log "WARNING: router not responding at ${url} - Claude Code will report a connection error"
}

# --- 3. MCP servers ---------------------------------------------------------
# They are declared in claude/mcp.json. We register them with scope `user`, because:
#   - managed settings accept only http/sse servers (stdio is rejected),
#   - managed-mcp.json takes exclusive control and silences all other servers.
# A marker file in the volume makes `claude mcp remove` persistent.
ensure_mcp_servers() {
  local file marker names name json hash
  file="${HARNESS_MCP_FILE:-/harness/claude/mcp.json}"
  marker="$HOME/.claude/.harness-mcp-installed"

  [ -r "$file" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  names="$(jq -r '(.mcpServers // {}) | keys[]' "$file" 2>/dev/null)" || return 0
  touch "$marker" 2>/dev/null || return 0

  # A server the harness added earlier that is no longer in mcp.json
  # (e.g. playwright after the switch to playwright-cli) - unregister it.
  for name in $(cut -d' ' -f1 "$marker" | sort -u); do
    printf '%s\n' "$names" | grep -qxF "$name" && continue
    claude mcp remove --scope user "$name" >/dev/null 2>&1 || true
    sed -i "/^${name}\( \|\$\)/d" "$marker" 2>/dev/null || true
    log "MCP server ${name} removed from claude/mcp.json - unregistered"
  done

  for name in $names; do
    json="$(jq -c --arg n "$name" '.mcpServers[$n]' "$file")"
    hash="$(printf '%s' "$json" | sha256sum | cut -c1-16)"

    # An entry "<name> <hash>" = this server, in this version of its definition, was already added.
    # If the user removed it afterwards (`claude mcp remove`), it stays removed.
    grep -qxF "${name} ${hash}" "$marker" 2>/dev/null && continue

    # Known name but a different hash (or a marker from an older harness version, without a hash)
    # -> the definition in mcp.json changed, so we register it again.
    if grep -qE "^${name}( |\$)" "$marker" 2>/dev/null; then
      log "MCP server ${name} definition changed - re-registering"
      claude mcp remove --scope user "$name" >/dev/null 2>&1 || true
      sed -i "/^${name}\( \|\$\)/d" "$marker" 2>/dev/null || true
    fi

    if claude mcp add-json --scope user "$name" "$json" >/dev/null 2>&1; then
      printf '%s %s\n' "$name" "$hash" >> "$marker"
      log "MCP server registered: ${name}"
    else
      log "WARNING: could not register MCP server ${name} (will retry on next start)"
    fi
  done
}

# --- 4. Claude Code config layers ------------------------------------------
# Claude Code has a single user directory (~/.claude, here: the volume). We add
# symlinks from successive layers to it; the first layer that has a given name wins:
#   1. volume       - whatever you create yourself in the container (real files are left alone)
#   2. harness      - claude/config/ from the harness repo
#   3. image        - /usr/local/share/packhorse (e.g. the playwright-cli skill
#                     in the version matching the CLI installed in the image)
#   4. host         - the host's ~/.claude, when HARNESS_INHERIT_HOST_CONFIG=1
# The marker file ~/.claude/.harness-links lists the symlinks created by the harness, so
# every start begins by removing them - turning the flag off or deleting a skill
# on the host takes effect in the container on the next start.
link_config_layers() {
  local claude_dir="$HOME/.claude" marker layer kind src name dst
  marker="${claude_dir}/.harness-links"

  if [ -f "$marker" ]; then
    while IFS= read -r dst; do
      [ -n "$dst" ] && [ -L "$dst" ] && rm -f "$dst"
    done < "$marker"
  fi
  : > "$marker" 2>/dev/null || return 0

  local layers=("$HARNESS_CONFIG" /usr/local/share/packhorse)
  inherit_host && layers+=("$HOST_CLAUDE")

  for layer in "${layers[@]}"; do
    [ -d "$layer" ] || continue
    for kind in agents commands skills output-styles; do
      [ -d "${layer}/${kind}" ] || continue
      for src in "${layer}/${kind}"/*; do
        [ -e "$src" ] || continue            # empty directory or broken symlink
        name="$(basename "$src")"
        # skills synced from claude.ai are fetched by the container itself, into the volume
        [ "$kind" = skills ] && [ "$name" = synced ] && continue
        dst="${claude_dir}/${kind}/${name}"
        if [ -e "$dst" ] || [ -L "$dst" ]; then continue; fi
        mkdir -p "${claude_dir}/${kind}"
        ln -s "$src" "$dst" && printf '%s\n' "$dst" >> "$marker"
      done
    done
  done

  # The host CLAUDE.md as user memory (the harness has its own in /etc/claude-code).
  if inherit_host && [ -e "${HOST_CLAUDE}/CLAUDE.md" ] && [ ! -e "${claude_dir}/CLAUDE.md" ] && [ ! -L "${claude_dir}/CLAUDE.md" ]; then
    ln -s "${HOST_CLAUDE}/CLAUDE.md" "${claude_dir}/CLAUDE.md" && printf '%s\n' "${claude_dir}/CLAUDE.md" >> "$marker"
  fi

  local n; n="$(wc -l < "$marker")"
  [ "$n" -gt 0 ] && log "config: ${n} items from the harness/image$(inherit_host && echo '/host') layers"
  return 0
}

# --- 5. user environment ---------------------------------------------------
prepare_home() {
  local home
  home="$(getent passwd "$USER_NAME" | cut -d: -f6)"
  mkdir -p "$home/.claude"
  # the named volume is mounted as root:root - without this Claude Code cannot save the login
  chown -R "$USER_NAME":"$(id -g "$USER_NAME")" "$home/.claude" 2>/dev/null || true
  if [ "${HARNESS_PLATFORM:-}" = "windows" ]; then
    # A bind mount from a Windows drive has no POSIX permissions - chown changes nothing there.
    log "windows platform: skipping chown /workspace"
  else
    [ -d /workspace ] && chown "$USER_NAME":"$(id -g "$USER_NAME")" /workspace 2>/dev/null || true
  fi
}

if [ "$(id -u)" = "0" ]; then
  install_managed_settings
  install_managed_memory
  install_host_settings
  prepare_home
  wait_for_router
  # Claude Code would treat an empty ANTHROPIC_AUTH_TOKEN as a provided key.
  if [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]; then unset ANTHROPIC_AUTH_TOKEN || true; fi
  if [ -z "${ANTHROPIC_API_KEY:-}" ]; then unset ANTHROPIC_API_KEY || true; fi
  exec gosu "$USER_NAME" "$0" "$@"
fi

link_config_layers
ensure_mcp_servers

case "${1:-}" in
  bash | sh | shell)
    shift || true
    exec bash "$@"
    ;;
  exec)
    shift
    exec "$@"
    ;;
  *)
    exec claude "$@"
    ;;
esac
