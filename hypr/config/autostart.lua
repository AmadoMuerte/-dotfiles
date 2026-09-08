hl.on("hyprland.start", function()
    -- Desktop
    hl.exec_cmd("waybar")
    hl.exec_cmd("swaync")

    -- Authentication
    hl.exec_cmd("env QT_QPA_PLATFORMTHEME=qt6ct /usr/lib/hyprpolkitagent/hyprpolkitagent")

    -- Idle and clipboard
    hl.exec_cmd("hypridle")
    hl.exec_cmd("wl-paste --watch cliphist store")

    -- Theme (dark system-wide + normal cursor)
    hl.exec_cmd("gsettings set org.gnome.desktop.interface color-scheme 'prefer-dark'")
    hl.exec_cmd("gsettings set org.gnome.desktop.interface gtk-theme 'adw-gtk3-dark'")
    hl.exec_cmd("gsettings set org.gnome.desktop.interface icon-theme 'Papirus-Dark'")
    hl.exec_cmd("gsettings set org.gnome.desktop.interface cursor-theme 'Adwaita'")

    -- Wallpaper
    hl.exec_cmd("awww-daemon")
    hl.exec_cmd("/home/amado/.local/bin/wallpaper.sh --restore")

    hl.exec_cmd("kdeconnect-indicator")
end)
