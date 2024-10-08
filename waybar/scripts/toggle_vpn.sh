#!/bin/bash

# Script for managing VPN connections
# Author: AmadoMuerte
# Date: 2024-08-11
# Description: This script checks for active VPN connections. 
#              If no VPN is active, it presents a menu of available VPN connections for the user to connect to.
#              If a VPN is active, it prompts the user to disconnect the active connection.
#              The script utilizes NetworkManager (nmcli) for managing VPN connections.



get_vpn_connections() {
    nmcli connection show | grep -E 'vpn|wireguard|openvpn' | awk '{print $1}'
}

connections=$(nmcli connection show --active | grep -E 'vpn|wireguard|openvpn' | awk '{print $1}')

if [ -z "$connections" ]; then
    vpn_list=$(get_vpn_connections)

    if [ -z "$vpn_list" ]; then
        zenity --info --text="No available VPN connections found."
    else
        selected_vpn=$(zenity --list --title="Available VPN Connections" --column="VPN Connections" $vpn_list)

        if [ $? -eq 0 ]; then
            nmcli connection up "$selected_vpn"
            zenity --info --text="Connected to $selected_vpn."
        fi
    fi
else
    active_vpn_list=$(echo "$connections" | tr '\n' ' ')
    disconnect_choice=$(zenity --question --text="Currently active VPN: $active_vpn_list. Do you want to disconnect?" --ok-label="Yes" --cancel-label="No")

    if [ $? -eq 0 ]; then
        for conn in $connections; do
            nmcli connection down "$conn"
            zenity --info --text="Disconnected from $conn."
        done
    fi
fi