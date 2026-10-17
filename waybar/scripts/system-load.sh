#!/usr/bin/env bash

# One compact CPU/GPU status line for Waybar. Sensors are discovered by their
# driver names so changing hwmon/card numbers after a reboot does not break it.

read_cpu_times() {
    local label user nice system idle iowait irq softirq steal guest guest_nice
    read -r label user nice system idle iowait irq softirq steal guest guest_nice < /proc/stat
    CPU_IDLE=$((idle + iowait))
    CPU_TOTAL=$((user + nice + system + idle + iowait + irq + softirq + steal))
}

read_temperature() {
    local wanted_name=$1
    local hwmon name

    for hwmon in /sys/class/hwmon/hwmon*; do
        [[ -r "$hwmon/name" ]] || continue
        read -r name < "$hwmon/name"
        if [[ "$name" == "$wanted_name" && -r "$hwmon/temp1_input" ]]; then
            awk '{ printf "%d", $1 / 1000 }' "$hwmon/temp1_input"
            return
        fi
    done

    printf '?'
}

find_gpu_device() {
    local busy device hwmon
    local fallback=''

    for busy in /sys/class/drm/card*/device/gpu_busy_percent; do
        [[ -r "$busy" ]] || continue
        device=${busy%/gpu_busy_percent}
        [[ -n "$fallback" ]] || fallback=$device

        # The discrete AMD GPU exposes edge, junction and memory temperatures.
        for hwmon in "$device"/hwmon/hwmon*; do
            if [[ -r "$hwmon/temp2_input" && -r "$hwmon/temp3_input" ]]; then
                printf '%s' "$device"
                return
            fi
        done
    done

    printf '%s' "$fallback"
}

read_cpu_times
previous_idle=$CPU_IDLE
previous_total=$CPU_TOTAL
sleep 0.2
read_cpu_times

delta_total=$((CPU_TOTAL - previous_total))
delta_idle=$((CPU_IDLE - previous_idle))
if ((delta_total > 0)); then
    cpu_usage=$(((100 * (delta_total - delta_idle) + delta_total / 2) / delta_total))
else
    cpu_usage=0
fi

cpu_temp=$(read_temperature k10temp)
gpu_device=$(find_gpu_device)
gpu_usage='?'
gpu_temp='?'

if [[ -n "$gpu_device" && -r "$gpu_device/gpu_busy_percent" ]]; then
    read -r gpu_usage < "$gpu_device/gpu_busy_percent"
    for gpu_hwmon in "$gpu_device"/hwmon/hwmon*; do
        if [[ -r "$gpu_hwmon/temp1_input" ]]; then
            gpu_temp=$(awk '{ printf "%d", $1 / 1000 }' "$gpu_hwmon/temp1_input")
            break
        fi
    done
fi

state=normal
if [[ "$cpu_temp" != '?' && "$cpu_temp" -ge 85 ]] ||
   [[ "$gpu_temp" != '?' && "$gpu_temp" -ge 90 ]]; then
    state=critical
elif [[ "$cpu_temp" != '?' && "$cpu_temp" -ge 75 ]] ||
     [[ "$gpu_temp" != '?' && "$gpu_temp" -ge 80 ]]; then
    state=warning
fi

# Pad the status line to a fixed character count: the bar label is monospace,
# so trailing spaces keep the module (and the whole right capsule) at a stable
# width while CPU/GPU numbers bounce around. CSS min-width is not an option --
# it renders a rounded-rect sliver artifact before the text.
text=$(printf 'CPU %d%% %s°C  GPU %s%% %s°C' \
    "$cpu_usage" "$cpu_temp" "$gpu_usage" "$gpu_temp")
printf -v text '%-28s' "$text"

printf '{"text":"%s","tooltip":"CPU: %d%%, %s°C\\nGPU: %s%%, %s°C","class":"%s"}\n' \
    "$text" \
    "$cpu_usage" "$cpu_temp" "$gpu_usage" "$gpu_temp" "$state"
