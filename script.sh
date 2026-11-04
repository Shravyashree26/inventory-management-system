#!bin/bash

docker compose down
echo "all application stopped"

docker compose up -d
echo "all application started"
