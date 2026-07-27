#!/bin/bash

./scripts/docker-stop.sh
./scripts/build-site.sh
./scripts/docker-start.sh

