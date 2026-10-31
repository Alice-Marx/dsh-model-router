#!/bin/sh
set -eu
# No sudo, firewall, VPN or service changes. SourceRoot is the extracted source archive.
source_root=${1:?Usage: install-linux.sh SOURCE_ROOT PREFIX AUTHORIZED_ROOT}
prefix=${2:?prefix required}
authorized_root=${3:?an explicit authorized root is required}
source_root=$(cd "$source_root" && pwd -P)
authorized_root=$(cd "$authorized_root" && pwd -P)
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<19))process.exit(1)'
version=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version' "$source_root/remote-computer-agent/package.json")
mkdir -p "$prefix/versions"
prefix=$(cd "$prefix" && pwd -P)
target="$prefix/versions/$version"
test ! -e "$target" || { echo 'Version directory already exists; preserve it and select a new prefix/version.' >&2; exit 1; }
umask 077
mkdir "$target"
cp "$source_root/remote-computer-agent/package.json" "$source_root/remote-computer-agent/package-lock.json" "$source_root/remote-computer-agent/build.mjs" "$target/"
cp -R "$source_root/remote-computer-agent/src" "$target/src"
(cd "$target" && npm ci --no-audit --no-fund && npm run build)
test -e "$prefix/config.json" || node "$target/dist/cli.mjs" init "$prefix/config.json" "$authorized_root"
node -e 'const fs=require("fs"),p=process.argv[1];const out={schemaVersion:1,node:process.version,platform:process.platform,arch:process.arch,abi:process.versions.modules};fs.writeFileSync(p,JSON.stringify(out,null,2)+"\n")' "$target/runtime.json"
printf 'Installed %s\nPair with: node %s/dist/cli.mjs pair %s/config.json CLIENT_ID CEILING.json\nStart with: node %s/dist/cli.mjs serve %s/config.json\n' "$version" "$target" "$prefix" "$target" "$prefix"
