hl.config({
    general = {
        extend_border_grab_area = 10,
        resize_on_border = true,
        layout = "dwindle",
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
