#!/usr/bin/env bash

set -u

TARGET="opencode-remote.target"

if systemctl --user is-active --quiet "$TARGET"; then
    systemctl --user stop "$TARGET"
else
    systemctl --user start "$TARGET"
fi
