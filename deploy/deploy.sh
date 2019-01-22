#!/bin/bash


echo -e "$PRIVATE_KEY" > /root/.ssh/id_rsa
chmod 600 /root/.ssh/id_rsa

./deploy/disableHostKeyChecking.sh


DEPLOY_SERVERS=$DEPLOY_SERVERS
ALL_SERVERS=(${DEPLOY_SERVERS//,/ })

for server in "${ALL_SERVERS[@]}"
do
    echo "deploying to ${server}"
  #ssh ubuntu@${server} 'bash' < ./deploy/updateAndRestart.sh
done