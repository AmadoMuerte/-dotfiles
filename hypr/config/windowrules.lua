-- Generic and Picture-in-Picture
hl.window_rule({ name = "remember-float-size", match = { float = true }, persistent_size = true })
hl.window_rule({
    name = "picture-in-picture",
    match = { title = "^([Pp]icture[ -]?[Ii]n[ -]?[Pp]icture)(.*)$" },
    float = true, keep_aspect_ratio = true, pin = true,
    size = "monitor_w*0.25 monitor_h*0.25",
})

-- Gaming
hl.window_rule({ name = "game-content-workspace", match = { content = 3 }, workspace = "name:gaming" })
hl.window_rule({ name = "game-tag", match = { xdg_tag = "^(.*game.*)$" }, workspace = "name:gaming", fullscreen_state = 2, content = "game", sync_fullscreen = true })
hl.window_rule({ name = "game-class-workspace", match = { class = "^(steam_app.*|gamescope)$" }, workspace = "name:gaming" })
hl.window_rule({ name = "steam-friends", match = { class = "^(steam)$", title = "^(Friends List)$" }, float = true })
hl.window_rule({ name = "steam-launching", match = { class = "^(steam)$", title = "^(Launching\\.{3})$" }, float = true, center = true, workspace = "name:gaming" })
hl.window_rule({
    name = "game-fullscreen",
    match = { class = "^(steam_app.*|gamescope)$", title = "^(.+)$", initial_title = "negative:^(.*[/]home[/].*)$" },
    content = "game", decorate = false, fullscreen_state = 2,
    size = "monitor_w monitor_h", sync_fullscreen = true,
})
hl.window_rule({
    name = "game-empty-title",
    match = { class = "^(steam_app.*)$", initial_title = "^$" },
    float = true, center = true, fullscreen = false, fullscreen_state = 0,
    workspace = "name:gaming",
})

-- Applications
hl.window_rule({ name = "wine-float", match = { class = "^(.*\\.exe)$", float = true }, center = true, fullscreen_state = 0, monitor = "DP-1" })
hl.window_rule({ name = "launchers", match = { class = "^(.*[Ll]auncher.*)$" }, float = true, monitor = "DP-1" })
hl.window_rule({ name = "chat-monitor", match = { class = "^(vesktop|discord)$" }, monitor = "DP-1" })
hl.window_rule({ name = "calculators", match = { class = "^(.*[Cc]alc.*)$" }, float = true, size = "monitor_w*0.17 monitor_h*0.43" })
hl.window_rule({ name = "keditfiletype", match = { class = "^(org\\.kde\\.keditfiletype)$" }, float = true })
hl.window_rule({ name = "ark-size", match = { class = "^(org\\.kde\\.ark)$" }, size = "monitor_w*0.40 monitor_h*0.40" })
hl.window_rule({ name = "v2rayn-workspace", match = { class = "^v2rayN$", initial_class = "^v2rayN$" }, workspace = "5 silent" })
hl.window_rule({
    name = "file-managers",
    match = { class = "^(org\\.kde\\.dolphin|org\\.gnome\\.Nautilus)$", title = "negative:^(Moving.*|Create New.*|Extract.*|Compress.*|Copying.*|Progress.*|Configure.*|Properties.*|Choose[ ]Application.*)$" },
    float = true, center = true, size = "monitor_w*0.50 monitor_h*0.55",
})

-- Opacity
hl.window_rule({ name = "browser-opacity", match = { class = "^(firefox|zen)$" }, opacity = "1.0 override" })
hl.window_rule({ name = "terminal-opacity", match = { class = "^(kitty|ghostty|[Kk]onsole|Alacritty|gnome-terminal|xfce[0-9]?-terminal)$" }, opacity = "1.0 override" })
hl.window_rule({ name = "media-opacity", match = { class = "^(mpv|org.kde.haruna|.*plex.*|org\\.kde\\.gwenview|.*vlc.*)$" }, opacity = "1.0 override" })

-- Floating utilities and dialogs
hl.window_rule({ name = "appearance-tools", match = { class = "^(kvantummanager|qt[56]ct|nwg-look)$" }, float = true })
hl.window_rule({ name = "system-tools", match = { class = "^(org.pulseaudio.pavucontrol|blueman-manager|nm-applet|nm-connection-editor)$" }, float = true })
hl.window_rule({ name = "proton-tools", match = { title = "^(Winetricks.*|Protontricks.*)$" }, float = true })
hl.window_rule({ name = "common-modals", match = { title = "^(Open|Authentication Required|Add Folder to Workspace|Choose Files|Save As|Confirm to replace files|File Operation Progress)$" }, float = true })
hl.window_rule({ name = "open-file", match = { initial_title = "^(Open File)$" }, float = true })
hl.window_rule({ name = "portal-gtk", match = { class = "^([Xx]dg-desktop-portal-gtk)$" }, float = true })
hl.window_rule({ name = "file-upload", match = { title = "^(File Upload|Choose wallpaper|Library)(.*)$" }, float = true })
hl.window_rule({ name = "dialog-class", match = { class = "^(.*dialog.*)$" }, float = true })
hl.window_rule({ name = "dialog-title", match = { title = "^(.*dialog.*)$" }, float = true })
hl.window_rule({ name = "share-picker", match = { class = "^(hyprland-share-picker)$" }, float = true })

-- Fullscreen and XWayland
hl.window_rule({ name = "fullscreen-idle-inhibit", match = { class = ".*" }, idle_inhibit = "fullscreen" })
hl.window_rule({ name = "suppress-maximize", match = { class = ".*" }, suppress_event = "maximize" })
hl.window_rule({
    name = "xwayland-drag",
    match = { class = "^$", title = "^$", xwayland = true, float = true, fullscreen = false, pin = false },
    no_focus = true,
})
