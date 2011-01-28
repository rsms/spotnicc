#!/bin/bash
if [ "$(whoami)" != "www-data" ]; then
  sudo -Hu www-data $0 $@
  exit $?
fi
cd "$(dirname "$0")"
git pull origin master
git submodule update --init
