#!/usr/bin/env bash

TARGET="opencode-remote.target"
WEB="opencode-web.service"
TUNNEL="opencode-tunnel.service"

if systemctl --user is-active --quiet "$WEB" &&
   systemctl --user is-active --quiet "$TUNNEL"; then

    printf '{"text":"󰖟 OC","class":"active","tooltip":"OpenCode Remote: включён\nНажми, чтобы выключить"}\n'

elif systemctl --user is-active --quiet "$TARGET"; then

    printf '{"text":"󰅖 OC","class":"error","tooltip":"OpenCode Remote: ошибка\nОдин из сервисов не работает\nНажми, чтобы выключить"}\n'

else

    printf '{"text":"󰖪 OC","class":"inactive","tooltip":"OpenCode Remote: выключен\nНажми, чтобы включить"}\n'
fi
