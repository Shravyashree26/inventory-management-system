#!bin/bash

docker compose down
echo "sonarcube stopped"

docker compose up -d
echo "sonarcube started"
