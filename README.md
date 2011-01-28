# Spotnicc

## Server setup

Ubuntu >=10

### Install packages

    apt-get install ...TODO

NPM

    sudo echo && curl http://npmjs.org/install.sh | sudo sh
    sudo chgrp -R www-data /usr/local/lib/node
    sudo chmod -R g+w /usr/local/lib/node
    npm install simpledb

### Checkout source

    sudo mkdir /var/spotnicc
    sudo chown www-data:www-data /var/spotnicc
    git clone <repo url> /var/spotnicc

### Configure & start services

    sudo ln -s /var/spotnicc/init.d/spotnicc-httpd /etc/init.d/
    sudo update-rc.d spotnicc-httpd defaults
    sudo invoke-rc.d spotnicc-httpd start

