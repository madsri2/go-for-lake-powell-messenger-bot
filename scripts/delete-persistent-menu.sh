#!/bin/bash

PAGE_ACCESS_TOKEN=`node /home/ec2-user/scripts/crypto.js --apat | grep -v Logger`;

curl -X DELETE -H "Content-Type: application/json" -d '{
  "fields":[
    "persistent_menu"
  ]
}' "https://graph.facebook.com/v2.6/me/messenger_profile?access_token=$PAGE_ACCESS_TOKEN"    
