hl.on("hyprland.start", function()
    -- Desktop
    hl.exec_cmd("waybar")
    hl.exec_cmd("swaync")

    -- Authentication
    hl.exec_cmd("env QT_QPA_PLATFORMTHEME=qt6ct /usr/lib/hyprpolkitagent/hyprpolkitagent")

    -- Idle and clipboard
    hl.exec_cmd("hypridle")
    hl.exec_cmd("wl-paste --watch cliphist store")

    -- Wallpaper
    hl.exec_cmd("awww-daemon")
    hl.exec_cmd("wallpaper.sh --restore")

    hl.exec_cmd("kdeconnect-indicator")
end)
