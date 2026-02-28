#!/usr/bin/env bash
set -euo pipefail

# cook installer
# Usage: curl -fsSL https://raw.githubusercontent.com/rjcorwin/arpi/main/install.sh | sh

REPO="rjcorwin/arpi"
BRANCH="main"
INSTALL_DIR="${COOK_INSTALL_DIR:-$HOME/.local/bin}"
SCRIPT_URL="https://raw.githubusercontent.com/${REPO}/${BRANCH}/cook"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BOLD}cook${NC} installer"
echo ""

# Create install directory
mkdir -p "$INSTALL_DIR"

# Download
echo -e "${CYAN}▸${NC} Downloading cook to ${INSTALL_DIR}/cook..."
if command -v curl &>/dev/null; then
    curl -fsSL "$SCRIPT_URL" -o "${INSTALL_DIR}/cook"
elif command -v wget &>/dev/null; then
    wget -q "$SCRIPT_URL" -O "${INSTALL_DIR}/cook"
else
    echo -e "${RED}✗${NC} Neither curl nor wget found. Install one and try again."
    exit 1
fi

chmod +x "${INSTALL_DIR}/cook"
echo -e "${GREEN}✓${NC} Installed to ${INSTALL_DIR}/cook"

# Check PATH
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
    echo ""
    echo -e "${YELLOW}⚠${NC} ${INSTALL_DIR} is not in your PATH."
    echo -e "  Add it by appending this to your shell profile (~/.bashrc, ~/.zshrc, etc.):"
    echo ""
    echo -e "    ${CYAN}export PATH=\"${INSTALL_DIR}:\$PATH\"${NC}"
    echo ""
fi

# Check Docker
echo ""
if command -v docker &>/dev/null; then
    echo -e "${GREEN}✓${NC} Docker found"
else
    echo -e "${YELLOW}⚠${NC} Docker is not installed."
    echo -e "  cook requires Docker to run Claude in a sandboxed container."
    echo -e "  Install: ${CYAN}https://docs.docker.com/get-docker/${NC}"
fi

# Check git
if command -v git &>/dev/null; then
    echo -e "${GREEN}✓${NC} git found"
else
    echo -e "${YELLOW}⚠${NC} git is not installed. cook requires git."
fi

echo ""
echo -e "${BOLD}Get started:${NC}"
echo -e "  ${CYAN}cd your-project${NC}"
echo -e "  ${CYAN}cook init${NC}                      # set up COOK.md and config"
echo -e "  ${CYAN}cook yolo \"Add dark mode\"${NC}      # let it cook"
echo ""
