#!/bin/bash

# Script for monitoring VPN connections
# Author: AmadoMuerte
# Date: 2024-08-11
# Description: This script continuously checks for active VPN connections using nmcli. 
#              It identifies if there are active Wireguard, generic VPN, or OpenVPN connections.
#              The output is formatted in JSON, providing details about the VPN connection status.
#              If a VPN is connected, it shows the connection name and type; if not connected,
#              it indicates that the VPN is disconnected. The status is updated every 5 seconds.

while true; do
    connWireguard=$(nmcli connection show --active | grep wireguard)
    connVPN=$(nmcli connection show --active | grep vpn)
    connOpenVPN=$(nmcli connection show --active | grep openvpn)

    if [ -n "$connWireguard" ]; then
        vpnName=$(echo "$connWireguard" | awk '{print $1}')
        echo "{\"text\": \"$vpnName 🛡️ (Wireguard)\", \"class\": \"custom-vpnstatus\", \"alt\": \"connected\"}"
    elif [ -n "$connVPN" ]; then
        vpnName=$(echo "$connVPN" | awk '{print $1}')
        echo "{\"text\": \"$vpnName 🛡️ (VPN)\", \"class\": \"custom-vpnstatus\", \"alt\": \"connected\"}"
    elif [ -n "$connOpenVPN" ]; then
        vpnName=$(echo "$connOpenVPN" | awk '{print $1}')
        echo "{\"text\": \"$vpnName 🛡️ (OpenVPN)\", \"class\": \"custom-vpnstatus\", \"alt\": \"connected\"}"
    else
        echo "{\"text\": \"Disconnected ❌\", \"class\": \"custom-vpnstatus\", \"alt\": \"disconnected\"}"
    fi
    sleep 5
done
