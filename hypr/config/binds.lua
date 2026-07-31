-- Переменные окружения
local mainMod = "SUPER"
local menu = "fuzzel"
local launchPrefix = "uwsm app -- " -- если не используете UWSM, замените на ""

---------------------------
---- WINDOW MANAGEMENT ----
---------------------------

-- Window manipulation
hl.bind(mainMod .. " + T",           hl.dsp.exec_cmd(launchPrefix .. TERMINAL))
hl.bind(mainMod .. " + Q",           hl.dsp.window.close())
hl.bind(mainMod .. " + SHIFT + Q",   hl.dsp.exec_cmd("hyprctl dispatch closewindow"))
hl.bind(mainMod .. " + W",           hl.dsp.window.fullscreen({ mode = 1 }))
hl.bind(mainMod .. " + SHIFT + F",   hl.dsp.exec_cmd("hyprctl dispatch togglefloating active && hyprctl dispatch pin active && hyprctl dispatch global active"))
hl.bind(mainMod .. " + F",           hl.dsp.window.float({ action = "toggle" }))
hl.bind(mainMod .. " + ALT + F",     hl.dsp.exec_cmd("hyprctl dispatch workspaceopt allfloat"))
hl.bind(mainMod .. " + V",           hl.dsp.window.float({ action = "toggle" }))
hl.bind(mainMod .. " + J",           hl.dsp.layout("togglesplit"))

-- Close/Exit
hl.bind("CTRL + ALT + Delete",       hl.dsp.exec_cmd("hyprctl dispatch exit 0"))
hl.bind(mainMod .. " + SHIFT + M",   hl.dsp.exec_cmd("hyprctl dispatch exit 0"))

-- Change focus
hl.bind(mainMod .. " + Left",  hl.dsp.focus({ direction = "left" }))
hl.bind(mainMod .. " + Right", hl.dsp.focus({ direction = "right" }))
hl.bind(mainMod .. " + Up",    hl.dsp.focus({ direction = "up" }))
hl.bind(mainMod .. " + Down",  hl.dsp.focus({ direction = "down" }))

-- Move active window
hl.bind(mainMod .. " + CTRL + Left",   hl.dsp.window.move({ direction = "l" }))
hl.bind(mainMod .. " + CTRL + Right",  hl.dsp.window.move({ direction = "r" }))
hl.bind(mainMod .. " + CTRL + Up",     hl.dsp.window.move({ direction = "u" }))
hl.bind(mainMod .. " + CTRL + Down", hl.dsp.window.move({ direction = "d" }))

hl.bind(mainMod .. " + SHIFT + Left",  hl.dsp.window.resize({ x = -100, y = 0, relative = true }), { repeating = true })
hl.bind(mainMod .. " + SHIFT + Right", hl.dsp.window.resize({ x = 100,  y = 0, relative = true }), { repeating = true })
hl.bind(mainMod .. " + SHIFT + Up",    hl.dsp.window.resize({ x = 0, y = -100, relative = true }), { repeating = true })
hl.bind(mainMod .. " + SHIFT + Down",  hl.dsp.window.resize({ x = 0, y = 100,  relative = true }), { repeating = true })

hl.bind(mainMod .. " + mouse:272", hl.dsp.window.drag())
hl.bind(mainMod .. " + mouse:273", hl.dsp.window.resize())
---- LAUNCHER ----
------------------

hl.bind(mainMod .. " + E",          hl.dsp.exec_cmd(launchPrefix .. FILE_MANAGER))
hl.bind(mainMod .. " + A",          hl.dsp.exec_cmd(menu))
hl.bind(mainMod .. " + SHIFT + S",  hl.dsp.exec_cmd("grim -g \"$(slurp)\" - | swappy -f -"))

---------------------------
---- HARDWARE CONTROLS ----
---------------------------

-- Альтернативные названия для медиа-клавиш (если работают)
hl.bind("XF86AudioRaiseVolume", hl.dsp.exec_cmd("pamixer -i 5"), { locked = true, repeating = true })
hl.bind("XF86AudioLowerVolume", hl.dsp.exec_cmd("pamixer -d 5"), { locked = true, repeating = true })
hl.bind("XF86AudioMute",        hl.dsp.exec_cmd("pamixer -t"),   { locked = true })
hl.bind("XF86AudioMicMute",     hl.dsp.exec_cmd("pamixer --default-source -t"), { locked = true })
hl.bind("XF86MonBrightnessUp",   hl.dsp.exec_cmd("brightnessctl set 10%+"), { locked = true, repeating = true })
hl.bind("XF86MonBrightnessDown", hl.dsp.exec_cmd("brightnessctl set 10%-"), { locked = true, repeating = true })

-------------------
---- WORKSPACES ----
-------------------

-- Switch workspaces (mainMod + 0-9)
for i = 1, 10 do
    local key = i % 10
    hl.bind(mainMod .. " + " .. key, hl.dsp.focus({ workspace = i }))
end

-- Move active window to workspace (mainMod + SHIFT + 0-9)
for i = 1, 10 do
    local key = i % 10
    hl.bind(mainMod .. " + SHIFT + " .. key, hl.dsp.window.move({ workspace = i }))
end

-- Scroll through workspaces
hl.bind(mainMod .. " + mouse_down", hl.dsp.focus({ workspace = "m+1" }))
hl.bind(mainMod .. " + mouse_up",   hl.dsp.focus({ workspace = "m-1" }))
