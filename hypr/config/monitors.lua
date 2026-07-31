-- Monitor wiki https://wiki.hypr.land/Configuring/Basics/Monitors/
-- Example: output can be found with hyprctl monitors. Edit variables.lua for the monitor outputs instead of here directly
-- hl.monitor({
--     output    = "MONITOR1",
--     mode      = "1920x1080@60",
--     position  = "0x0",
--     scale     = "1",
-- })

-- Определяем переменные для мониторов


-- Настройка первого монитора (главный, например, слева)
hl.monitor({
    output    = MONITOR1,
    mode      = "2560x1440@180",  -- разрешение 2K + частота
    scale     = 1.0,              -- масштаб (для 2K обычно 1.0 или 1.25)
})

-- Настройка второго монитора (справа от первого)
hl.monitor({
    output    = MONITOR2,
    mode      = "2560x1440@180",  -- разрешение 2K + частота
    scale     = 1.0,              -- масштаб
})
