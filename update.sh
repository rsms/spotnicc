#!/bin/bash
if [ "$(whoami)" != "root" ]; then
  sudo $0 $@
  exit $?
fi
cd "$(dirname "$0")"
sudo -Hu www-data git pull origin master
sudo -Hu www-data git submodule update --init

invoke-rc.d spotnicc-httpd restart
