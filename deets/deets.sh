#!/bin/bash

set -e

cd "$(dirname ${BASH_SOURCE[0]})"
configPathsJson=$(readlink -m "configPaths.json")

cd ../current/products

echo "Finding config paths"
echo -n '{' > "$configPathsJson.tmp"
for pth in `find ./ -name 'cdns' -printf '%P\n' | sort -V`; do
  k=$(dirname $pth);
  v=$(grep '^us|' $pth | awk -F '|' '{print $2}');
  echo -n '"'"$k"'":"'"$v"'",';
done >> "$configPathsJson.tmp"
echo -n '"-":""}' >> "$configPathsJson.tmp"
mv "$configPathsJson.tmp" "$configPathsJson"

echo "Finding product config URLs"
tempdir=$(mktemp -d)
echo "Created temp dir $tempdir"

for pth in `find ./ -name 'versions' -printf '%P\n' | sort -V`; do
  hash=$(grep '^us|' $pth | awk -F '|' '{print $7}')
  if [ "$hash" != "" ]; then
    echo "https://level3.blizzard.com/tpr/configs/data/${hash:0:2}/${hash:2:2}/$hash" >> "$tempdir/urls.txt"
  fi
done

echo "Getting URLs"
cd "$tempdir"
wget -i urls.txt
rm urls.txt

echo "Generating deets"
cd "$(dirname ${BASH_SOURCE[0]})"
php deets.php "$tempdir" > deets.json.tmp
mv deets.json.tmp deets.json

echo "Removing $tempdir"
rm -rf "$tempdir"
