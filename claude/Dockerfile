# ============================================================================
#  Claude Code container with full visibility into the host.
#  Diagnostic tools live in the image; host access is granted by docker-compose.yml
#  (privileged, pid: host, /host, /dev, /sys, GPU).
# ============================================================================
FROM node:22-bookworm-slim

ARG CLAUDE_CODE_VERSION=latest
ARG HOST_UID=1000
ARG HOST_GID=1000
ARG DOCKER_GID=984
ARG DOCKER_CLI_VERSION=27.5.1
ARG DOCKER_COMPOSE_VERSION=5.5.1
ARG DOCKER_BUILDX_VERSION=0.37.1
# Playwright (playwright-cli + browser) adds ~700 MB to the image. 0 = skip it.
ARG INSTALL_PLAYWRIGHT=1
ARG PLAYWRIGHT_BROWSER=chromium

RUN apt-get update && apt-get install -y --no-install-recommends \
      # Claude Code working basics
      git curl wget ca-certificates ripgrep fd-find jq less nano vim-tiny \
      unzip zip xz-utils file tini gosu sudo rsync openssh-client \
      # Python for writing ad hoc tools: interpreter, pip, venv, pipx + HTML->MD converter
      python3 python3-pip python3-venv python3-dev pipx python3-html2text build-essential \
      # processes and signals (pid: host)
      procps psmisc htop lsof strace ltrace \
      # CPU / RAM / IO / sensors
      sysstat util-linux bsdextrautils lm-sensors dmidecode \
      # disks and block devices
      smartmontools nvme-cli hdparm ncdu tree parted udev \
      # hardware and PCI (the GPU is visible even without nvidia-smi)
      pciutils usbutils \
      # network
      iproute2 iputils-ping net-tools dnsutils netcat-openbsd traceroute socat \
    && rm -rf /var/lib/apt/lists/*

# Docker client (no daemon) - drives the host's /var/run/docker.sock.
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) dockerarch=x86_64 ;; arm64) dockerarch=aarch64 ;; *) dockerarch="$arch" ;; esac; \
    curl -fsSL "https://download.docker.com/linux/static/stable/${dockerarch}/docker-${DOCKER_CLI_VERSION}.tgz" \
      -o /tmp/docker.tgz; \
    tar -xzf /tmp/docker.tgz -C /tmp; \
    install -m 0755 /tmp/docker/docker /usr/local/bin/docker; \
    rm -rf /tmp/docker /tmp/docker.tgz; \
    docker --version

# CLI plugins: Compose v2 (`docker compose`) and Buildx (`docker buildx`, BuildKit builds -
# without it `docker build` / `compose build` fall back to the deprecated legacy builder).
# The static client above ships without plugins. Installed system-wide (not in
# ~/.docker/cli-plugins) so they survive a fresh home; checksum-verified.
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) composearch=x86_64 ;; arm64) composearch=aarch64 ;; *) composearch="$arch" ;; esac; \
    plugins=/usr/local/lib/docker/cli-plugins; \
    base="https://github.com/docker/compose/releases/download/v${DOCKER_COMPOSE_VERSION}"; \
    curl -fsSL "$base/docker-compose-linux-${composearch}" -o /tmp/docker-compose; \
    expected="$(curl -fsSL "$base/docker-compose-linux-${composearch}.sha256" | cut -d' ' -f1)"; \
    echo "${expected}  /tmp/docker-compose" | sha256sum -c -; \
    install -D -m 0755 /tmp/docker-compose "$plugins/docker-compose"; \
    base="https://github.com/docker/buildx/releases/download/v${DOCKER_BUILDX_VERSION}"; \
    asset="buildx-v${DOCKER_BUILDX_VERSION}.linux-${arch}"; \
    curl -fsSL "$base/$asset" -o /tmp/docker-buildx; \
    expected="$(curl -fsSL "$base/checksums.txt" | grep " \*${asset}\$" | cut -d' ' -f1)"; \
    test -n "$expected"; \
    echo "${expected}  /tmp/docker-buildx" | sha256sum -c -; \
    install -D -m 0755 /tmp/docker-buildx "$plugins/docker-buildx"; \
    rm -f /tmp/docker-compose /tmp/docker-buildx; \
    docker compose version; \
    docker buildx version

# uv/uvx - the fastest way to run a one-off Python package without touching the system.
RUN set -eux; \
    curl -fsSL https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh; \
    uv --version; uvx --version

RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    && npm cache clean --force \
    && claude --version

# Playwright: `playwright-cli` (@playwright/cli, https://github.com/microsoft/playwright-cli)
# - an agent-oriented CLI, used by the web-fetch agent - plus the classic `playwright`
# (screenshot, codegen, install). The MCP server (@playwright/mcp) is left out on purpose.
#
# VERSIONS MUST MATCH. Playwright ties the browser build to the library version
# (the chromium-<revision> directory), and @playwright/cli pulls in its own - often an alpha.
# A browser installed by a different `playwright` fails at runtime with
# "Chromium distribution ... is not found". So we derive the `playwright` version
# from the dependencies of @playwright/cli itself, and that version installs the browser.
# Browsers go to /opt/ms-playwright so that a non-root user can read them.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN set -eux; \
    if [ "$INSTALL_PLAYWRIGHT" = "1" ]; then \
      npm install -g @playwright/cli@latest; \
      PW_VERSION="$(node -p "require('/usr/local/lib/node_modules/@playwright/cli/package.json').dependencies.playwright")"; \
      echo "playwright required by @playwright/cli: ${PW_VERSION}"; \
      npm install -g "playwright@${PW_VERSION}"; \
      playwright install --with-deps "$PLAYWRIGHT_BROWSER"; \
      chmod -R a+rX /opt/ms-playwright; \
      npm cache clean --force; \
      playwright --version; \
      playwright-cli --version; \
      ls /opt/ms-playwright; \
      # The playwright-cli skill matching the installed CLI version - the "image" layer
      # of the Claude Code config (the entrypoint links it into ~/.claude/skills).
      skill="$(dirname "$(find /usr/local/lib/node_modules/@playwright/cli -path '*/skills/playwright-cli/SKILL.md' | head -n 1)")"; \
      test -f "$skill/SKILL.md"; \
      mkdir -p /usr/local/share/packhorse/skills; \
      ln -s "$skill" /usr/local/share/packhorse/skills/playwright-cli; \
    else \
      echo "skipping Playwright (INSTALL_PLAYWRIGHT=$INSTALL_PLAYWRIGHT)"; \
    fi

# A user with the host UID/GID: files in /workspace and /host get the correct owner.
# The node image already has uid 1000 (node) - if the host UID is 1000, we reuse that account.
RUN set -eux; \
    if [ "$HOST_GID" != "1000" ]; then groupadd -g "$HOST_GID" claude || true; fi; \
    if [ "$HOST_UID" = "1000" ]; then \
      usermod -l claude -d /home/claude -m node; \
      groupmod -n claude node || true; \
    else \
      useradd -u "$HOST_UID" -g "$HOST_GID" -m -s /bin/bash claude; \
    fi; \
    groupadd -g "$DOCKER_GID" hostdocker || true; \
    usermod -aG "$DOCKER_GID" claude; \
    usermod -aG sudo claude; \
    echo 'claude ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/claude; \
    chmod 0440 /etc/sudoers.d/claude; \
    mkdir -p /home/claude/.claude /workspace /etc/claude-code/managed-settings.d; \
    chown -R claude:"$HOST_GID" /home/claude /workspace

# Global playwright-cli config (~/.playwright/cli.config.json):
#   - browserName: without it the CLI looks for the Google Chrome channel
#     (/opt/google/chrome/chrome), which the image does not have, and fails with
#     "Chromium distribution 'chrome' is not found",
#   - chromiumSandbox: false - standard in a container,
#   - outputDir: automatic snapshots go to /tmp instead of .playwright-cli/ in the repo
#     (files with an explicit --filename still land in the working directory).
RUN set -eux; \
    home="$(getent passwd claude | cut -d: -f6)"; \
    mkdir -p "$home/.playwright"; \
    jq -n --arg b "$PLAYWRIGHT_BROWSER" '{browser: {browserName: $b, isolated: true, launchOptions: {chromiumSandbox: false}}, outputDir: "/tmp/playwright-cli"}' \
      > "$home/.playwright/cli.config.json"; \
    chown -R claude "$home/.playwright"

COPY bin/hostinfo /usr/local/bin/hostinfo
COPY bin/harness-context /usr/local/bin/harness-context
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/hostinfo /usr/local/bin/harness-context /usr/local/bin/entrypoint.sh

ENV HOME=/home/claude \
    CLAUDE_CONFIG_DIR=/home/claude/.claude \
    HARNESS_USER=claude \
    # Debian blocks system-wide `pip install` (PEP 668). In a container that is just
    # an obstacle - the agent should work right away, without a venv for every small task.
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_ROOT_USER_ACTION=ignore \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=all \
    # ~/.local/bin: where `pip install --user` (the default for non-root) puts scripts
    PATH=/home/claude/.local/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/sbin:/usr/bin:/bin

WORKDIR /workspace

# tini reaps zombies - with pid: host this is not a theoretical problem.
ENTRYPOINT ["/usr/bin/tini", "-s", "--", "/usr/local/bin/entrypoint.sh"]
