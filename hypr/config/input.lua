hl.config({
    input = {
        kb_layout = "us,ru",
        kb_variant = "",
        kb_options = "grp:alt_shift_toggle",
        repeat_rate = 25,
        repeat_delay = 300,
        accel_profile = "flat",
    },
})

hl.gesture({ fingers = 4, direction = "horizontal", action = "workspace" })
hl.gesture({ fingers = 3, direction = "down", action = "close" })
hl.gesture({ fingers = 3, direction = "up", action = "fullscreen" })
hl.gesture({ fingers = 3, direction = "left", action = "float" })
