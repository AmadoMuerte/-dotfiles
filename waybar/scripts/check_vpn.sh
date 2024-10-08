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
  connections=$(nmcli connection show --active)

  if grep -q "wireguard" <<< "$connections"; then
    vpnName=$(grep "wireguard" <<< "$connections" | awk '{print $1}')
    echo "{\"text\": \"$vpnName ✞\", \"class\": \"custom-vpnstatus\", \"alt\": \"connected\"}"
  elif grep -q "vpn" <<< "$connections"; then
    vpnName=$(grep "vpn" <<< "$connections" | awk '{print $1}')
    echo "{\"text\": \"$vpnName ✞\", \"class\": \"custom-vpnstatus\", \"alt\": \"connected\"}"
  elif grep -q "openvpn" <<< "$connections"; then
    vpnName=$(grep "openvpn" <<< "$connections" | awk '{print $1}')
    echo "{\"text\": \"$vpnName ✞\", \"class\": \"custom-vpnstatus\", \"alt\": \"connected\"}"
  else
    echo "{\"text\": \"Not connected ✞\", \"class\": \"custom-vpnstatus\", \"alt\": \"disconnected\"}"
  fi
  sleep 5
done