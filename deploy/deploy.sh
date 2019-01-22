#!/bin/bash

set -e

eval $(ssh-agent -s)
echo "$PRIVATE_KEY" | tr -d '\r' | ssh-add - > /dev/null

./deploy/disableHostKeyChecking.sh


DEPLOY_SERVERS=$DEPLOY_SERVERS
ALL_SERVERS=(${DEPLOY_SERVERS//,/ })

for server in "${ALL_SERVERS[@]}"
do
    echo "deploying to ${server}"
  #ssh ubuntu@${server} 'bash' < ./deploy/updateAndRestart.sh
done