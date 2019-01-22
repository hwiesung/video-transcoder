#!/bin/bash

# any future command that fails will exit the script
set -e

# Delete the old repo
rm -rf /home/ubuntu/peeple-transcoder/

# clone the repo again
git clone https://hwiesung:wjdgnltjd1@gitlab.com/peeple/peeple-transcoder.git

pm2 kill

pm2 status

cd /home/ubuntu/peeple-transcoder

#install npm packages
echo "Running npm install"
npm install

#Restart the node server
npm start
