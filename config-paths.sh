#!/bin/bash

cd "$(dirname ${BASH_SOURCE[0]})"
resultPath=$(readlink -m "site/configPaths.json")

cd current/products

echo -n '{' > "$resultPath.tmp"
for pth in `find ./ -name 'cdns' -printf '%P\n' | sort -V`; do k=$(dirname $pth); v=$(grep '^us|' $pth | awk -F '|' '{print $2}'); echo -n '"'"$k"'":"'"$v"'",'; done >> "$resultPath.tmp"
echo -n '"-":""}' >> "$resultPath.tmp"

mv "$resultPath.tmp" "$resultPath"
