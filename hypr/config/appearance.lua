hl.config({
    general = {
        gaps_in = 3,
        gaps_out = 8,
        border_size = 2,
        extend_border_grab_area = 10,
        resize_on_border = true,
        col = {
            active_border = { colors = { colors.surface, colors.inactiveBord }, angle = 45 },
            inactive_border = "rgba(313539FF)",
        },
        layout = "dwindle",
    },
    group = {
        col = {
            border_active = colors.accent,
            border_inactive = colors.inactiveBord,
            border_locked_active = colors.groupLocked,
            border_locked_inactive = colors.inactiveBord,
        },
        groupbar = {
            col = {
                active = colors.accent,
                inactive = colors.inactiveBord,
                locked_active = colors.accent,
                locked_inactive = colors.inactiveBord,
            },
        },
    },
    decoration = {
        dim_special = 0.3,
        rounding = 5,
        active_opacity = 0.95,
        inactive_opacity = 0.85,
        fullscreen_opacity = 1.0,
        blur = { size = 5, passes = 4, special = true },
    },
    dwindle = { preserve_split = true },
    misc = {
        disable_hyprland_logo = true,
        middle_click_paste = false,
        enable_swallow = true,
        swallow_regex = "(kitty|ghostty|[Kk]onsole|Alacritty|gnome-terminal|xfce[0-9]?-terminal)",
        vrr = 3,
    },
    ecosystem = { no_update_news = true, no_donation_nag = true },
    xwayland = { force_zero_scaling = true },
})
