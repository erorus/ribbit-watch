#!/bin/bash

cd "$( dirname "${BASH_SOURCE[0]}" )"
php -S 0.0.0.0:7777 -t site &
phppid=$!
node main.js
kill -s SIGINT $phppid
