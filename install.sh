#!/bin/sh
set -eu

# cook installer — clone, build, install
# Usage: curl -fsSL https://raw.githubusercontent.com/rjcorwin/cook/main/install.sh | sh

REPO_URL="https://github.com/rjcorwin/cook.git"
INSTALL_DIR="${COOK_INSTALL_DIR:-$HOME/.local/bin}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

printf "${BOLD}cook${NC} installer\n\n"

# --- Check prerequisites ---

fail=0

if ! command -v git >/dev/null 2>&1; then
    printf "${RED}x${NC} git is required but not installed.\n"
    fail=1
fi

if ! command -v go >/dev/null 2>&1; then
    printf "${RED}x${NC} go is required but not installed.\n"
    printf "  Install: ${CYAN}https://go.dev/dl/${NC}\n"
    fail=1
fi

if ! command -v docker >/dev/null 2>&1; then
    printf "${YELLOW}!${NC} Docker is not installed (required at runtime, not for building).\n"
    printf "  Install: ${CYAN}https://docs.docker.com/get-docker/${NC}\n"
fi

if [ "$fail" -eq 1 ]; then
    printf "\nInstall the missing prerequisites and try again.\n"
    exit 1
fi

# --- Build ---

# Detect if we're already inside the cook repo
IN_REPO=0
if [ -f "cook/main.go" ] && [ -f "cook/go.mod" ]; then
    IN_REPO=1
    SRC_DIR="$(pwd)"
fi

if [ "$IN_REPO" -eq 0 ]; then
    SRC_DIR="$(mktemp -d)"
    printf "${CYAN}>${NC} Cloning cook...\n"
    git clone --depth 1 "$REPO_URL" "$SRC_DIR" 2>&1
fi

printf "${CYAN}>${NC} Building...\n"
cd "$SRC_DIR/cook"
go build -o cook .

# --- Install ---

mkdir -p "$INSTALL_DIR"
cp cook "$INSTALL_DIR/cook"
chmod +x "$INSTALL_DIR/cook"
printf "${GREEN}ok${NC} Installed to ${INSTALL_DIR}/cook\n"

# Clean up temp dir
if [ "$IN_REPO" -eq 0 ]; then
    rm -rf "$SRC_DIR"
fi

# --- PATH check ---

case ":${PATH}:" in
    *":${INSTALL_DIR}:"*) ;;
    *)
        printf "\n${YELLOW}!${NC} ${INSTALL_DIR} is not in your PATH.\n"
        printf "  Add this to your shell profile (~/.bashrc, ~/.zshrc, etc.):\n\n"
        printf "    ${CYAN}export PATH=\"%s:\$PATH\"${NC}\n\n" "$INSTALL_DIR"
        ;;
esac

# --- Done ---

printf "\n${BOLD}Get started:${NC}\n"
printf "  ${CYAN}cd your-project${NC}\n"
printf "  ${CYAN}cook init${NC}                      # set up COOK.md and config\n"
printf "  ${CYAN}cook \"Add dark mode\"${NC}            # let it cook\n\n"
