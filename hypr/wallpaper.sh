#!/usr/bin/env bash
set -euo pipefail

wall_dir="${WALLPAPER_DIR:-$HOME/Pictures/Wallpapers}"
mkdir -p "$wall_dir"

files=$(find "$wall_dir" -maxdepth 1 -type f \
    \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' -o -iname '*.gif' \) \
    -printf '%f\n' 2>/dev/null | sort)

if [[ -z "$files" ]]; then
    printf 'No wallpapers in %s.\n' "$wall_dir" >&2
    exit 1
fi

selection=$(printf '%s\n' "$files" | fuzzel --dmenu --prompt 'Wallpaper: ')
[[ -n "$selection" ]] || exit 0
awww img --all "$wall_dir/$selection"
mkdir -p "$HOME/.cache"
printf '%s' "$wall_dir/$selection" > "$HOME/.cache/wallpaper-current"
