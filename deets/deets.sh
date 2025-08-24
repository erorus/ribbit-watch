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
  echo "Processing product ${product}"

  # Look for the US region line.
  region='us';
  set +e
  grep -q "^${region}|" $pth
  exitCode=$?
  set -e
  if [ $exitCode -ne 0 ]; then
    # US region line not found, pick first region line.
    region=$(grep -A 1 '^## seqn = ' $pth | tail -n 1 | awk -F '|' '{print $1}')
  fi
  if [ "$region" == "" ]; then
    # Found no region lines, skip it.
    continue
  fi

  # Get the product config hash.
  hash=$(grep "^${region}|" $pth | awk -F '|' '{print $7}')
  if [ "$hash" != "" ]; then
    # Found product config. Add it to URLs and our map of hash => product
    echo "https://level3.blizzard.com/tpr/configs/data/${hash:0:2}/${hash:2:2}/$hash" >> "$tempdir/urls.txt"
    echo "$hash $product ProductConfig" >> "$tempdir/map.txt"
    # We're done here.
    continue
  fi

  # No product config found, look for build config.
  hash=$(grep "^${region}|" $pth | awk -F '|' '{print $2}')
  if [ "$hash" == "" ]; then
    # No build config found, either.
    continue
  fi

  # Found build config. Get config path.
  set +e
  configPath=$(jq -e -r '.["'"${product}"'"]' "$configPathsJson")
  exitCode=$?
  set -e
  if [ $exitCode -eq 0 ]; then
    # Found config path. Add it to URLs and our map of hash => product
    echo "https://level3.blizzard.com/${configPath}/config/${hash:0:2}/${hash:2:2}/$hash" >> "$tempdir/urls.txt"
    echo "$hash $product BuildConfig" >> "$tempdir/map.txt"
  fi
done

echo "Getting URLs"
cd "$tempdir"
set +e
wget -i urls.txt
set -e
rm urls.txt

echo "Generating deets"
cd "$homeDir"
php deets.php "$tempdir" > deets.json.tmp
mv deets.json.tmp deets.json

echo "Removing $tempdir"
rm -rf "$tempdir"
