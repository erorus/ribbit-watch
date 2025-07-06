#!/bin/bash

set -e

cd "$(dirname ${BASH_SOURCE[0]})"
homeDir="$(pwd)"
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
  product=$(dirname $pth)
  hash=$(grep '^us|' $pth | awk -F '|' '{print $7}')
  if [ "$hash" == "" ]; then
    hash=$(grep -A 1 '^## seqn = ' $pth | tail -n 1 | awk -F '|' '{print $7}')
  fi
  if [ "$hash" != "" ]; then
    echo "https://level3.blizzard.com/tpr/configs/data/${hash:0:2}/${hash:2:2}/$hash" >> "$tempdir/urls.txt"
    echo "$hash $product" >> "$tempdir/map.txt"
  fi
done

echo "Getting URLs"
cd "$tempdir"
wget -i urls.txt
rm urls.txt

echo "Generating deets"
cd "$homeDir"
php deets.php "$tempdir" > deets.json.tmp
mv deets.json.tmp deets.json

echo "Removing $tempdir"
rm -rf "$tempdir"
