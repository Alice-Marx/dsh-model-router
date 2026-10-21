import argparse
import base64
import gzip
import io
import json
import os
import re
import sys
import tarfile
import hashlib
import urllib.request
import urllib.error
from urllib.parse import urlparse

# Fixed constants per implementation contract
ORIGINAL_PKG = "@ljwei-stak/dsh-model-router"
TARGET_PKG = "@alice-marx/dsh-model-router"
REPO_OWNER = "Alice-Marx"
REPO_NAME = "dsh-model-router"
NPM_REGISTRY = "https://registry.npmjs.org"
GITHUB_API = "https://api.github.com"

def request_url(url, timeout=60, retries=1):
    """Fetch URL with bounded retries, no secret access."""
    headers = {"User-Agent": "prepare-github-package/1.0"}
    req = urllib.request.Request(url, headers=headers)
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise ValueError(f"Resource not found: {url}") from e
            elif e.code == 403:
                raise ValueError(f"Forbidden access to {url}") from e
            else:
                if attempt < retries:
                    continue
                raise ValueError(f"HTTP error {e.code} for {url}: {e.reason}") from e
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < retries:
                continue
            raise ValueError(f"Request failed for {url}: {str(e)}") from e
    raise RuntimeError("Unreachable")

def calculate_hash(data, algo="sha256"):
    """Calculate cryptographic hash of bytes."""
    h = hashlib.new(algo)
    h.update(data)
    return h.hexdigest()

def calculate_file_hash(filepath, algo="sha256"):
    """Calculate cryptographic hash of a file."""
    h = hashlib.new(algo)
    with open(filepath, "rb") as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest()

def validate_version(version):
    """Enforce strict x.y.z stable version format."""
    if not re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", version):
        raise ValueError(f"Invalid version format: {version}. Must be x.y.z stable version.")
    return version

def cmd_prepare(args):
    version = validate_version(args.version)
    output_dir = args.output_dir
    os.makedirs(output_dir, exist_ok=True)

    # Step 1: Fetch and validate npm package metadata
    npm_meta_url = f"{NPM_REGISTRY}/{ORIGINAL_PKG.replace('/', '%2F')}/{version}"
    print(f"Fetching npm metadata from {npm_meta_url}")
    npm_meta = json.loads(request_url(npm_meta_url))

    if npm_meta.get("name") != ORIGINAL_PKG or npm_meta.get("version") != version:
        raise ValueError("Npm metadata identity mismatch")
    dist = npm_meta.get("dist", {})
    if not dist.get("tarball"):
        raise ValueError("NPM metadata missing dist.tarball")
    tarball_url = dist["tarball"]
    parsed_tarball_url = urlparse(tarball_url)
    if parsed_tarball_url.scheme != "https" or parsed_tarball_url.hostname != "registry.npmjs.org":
        raise ValueError(f"NPM tarball hostname is not registry.npmjs.org: {parsed_tarball_url.hostname}")

    expected_sha512 = dist.get("integrity")
    if not expected_sha512 or not expected_sha512.startswith("sha512-"):
        raise ValueError("NPM metadata missing valid sha512 integrity")

    # Step 2: Fetch and validate GitHub release metadata
    release_url = f"{GITHUB_API}/repos/{REPO_OWNER}/{REPO_NAME}/releases/tags/v{version}"
    print(f"Fetching GitHub release metadata from {release_url}")
    release_meta = json.loads(request_url(release_url))

    if release_meta.get("draft", True):
        raise ValueError(f"Release v{version} is a draft")
    if release_meta.get("prerelease", True):
        raise ValueError(f"Release v{version} is a prerelease")
    if release_meta.get("tag_name") != f"v{version}":
        raise ValueError(f"Release tag name mismatch: {release_meta.get('tag_name')} != v{version}")

    # Locate required release asset
    target_asset_name = f"ljwei-stak-dsh-model-router-{version}.tgz"
    target_asset = None
    for asset in release_meta.get("assets", []):
        if asset.get("name") == target_asset_name:
            target_asset = asset
            break
    if not target_asset:
        raise ValueError(f"Asset {target_asset_name} not found in release v{version}")

    asset_digest = target_asset.get("digest", "")
    if not asset_digest.startswith("sha256:"):
        raise ValueError(f"Asset digest is not sha256: {asset_digest}")
    expected_asset_sha256 = asset_digest.split(":", 1)[1]

    # Step 3: Download and verify source npm tarball
    print(f"Downloading npm tarball from {tarball_url}")
    npm_tarball_bytes = request_url(tarball_url)
    actual_sha512 = "sha512-" + base64.b64encode(hashlib.sha512(npm_tarball_bytes).digest()).decode("ascii")
    if actual_sha512 != expected_sha512:
        raise ValueError(f"NPM tarball sha512 mismatch: expected {expected_sha512}, got {actual_sha512}")
    source_sha256 = calculate_hash(npm_tarball_bytes, "sha256")
    print(f"Source tarball SHA256: {source_sha256}")

    # The Release asset and npm distribution must be the very same bytes.
    if source_sha256 != expected_asset_sha256:
        raise ValueError("Npm tarball differs from the verified GitHub Release asset")

    # Step 5: Extract source tarball in memory (no disk I/O)
    npm_tar_buffer = io.BytesIO(npm_tarball_bytes)
    with tarfile.open(fileobj=npm_tar_buffer, mode="r:gz") as tar_src:
        members = []
        seen_names = set()
        file_contents = {}
        for member in tar_src.getmembers():
            # Reject invalid entries
            if member.name in seen_names:
                raise ValueError(f"Duplicate tar entry: {member.name}")
            seen_names.add(member.name)
            if not member.isreg():
                raise ValueError(f"Non-regular tar entry: {member.name}")
            path_parts = member.name.split("/")
            if any(part in ("", ".", "..") for part in path_parts) or "\\" in member.name or ":" in member.name:
                raise ValueError(f"Unsafe tar entry path: {member.name}")
            if not member.name.startswith("package/"):
                raise ValueError(f"Non-package-prefix tar entry: {member.name}")
            # Extract content to memory
            content = tar_src.extractfile(member).read()
            file_contents[member.name] = content
            members.append(member)

    # Validate original package metadata
    pkg_json_path = "package/package.json"
    if pkg_json_path not in file_contents:
        raise ValueError("Missing package/package.json in source tarball")
    original_pkg_data = json.loads(file_contents[pkg_json_path].decode("utf-8"))

    if original_pkg_data.get("name") != ORIGINAL_PKG:
        raise ValueError(f"Original package name mismatch: {original_pkg_data.get('name')} != {ORIGINAL_PKG}")
    if original_pkg_data.get("version") != version:
        raise ValueError(f"Original package version mismatch: {original_pkg_data.get('version')} != {version}")
    repo_url = original_pkg_data.get("repository", {}).get("url", "")
    if repo_url != f"git+https://github.com/{REPO_OWNER}/{REPO_NAME}.git":
        raise ValueError(f"Original repository mismatch: {repo_url}")
    main_entry = original_pkg_data.get("main", "").removeprefix("./")
    if not main_entry or "package/" + main_entry not in file_contents:
        raise ValueError("Manifest main entrypoint is absent from the archive")

    # Collect runtime files from tar members (no filesystem extraction)
    runtime_files = []
    for member in members:
        fname = member.name
        if fname.startswith("package/.dsh-plugin/") and fname.endswith(".mjs"):
            if fname not in runtime_files:
                runtime_files.append(fname)
        if fname in ("package/.dsh-plugin/client.js", "package/cordis.patch.yml"):
            if fname not in runtime_files:
                runtime_files.append(fname)
    for rpath in runtime_files:
        if rpath not in file_contents:
            raise ValueError(f"Missing runtime file: {rpath}")

    # Precompute source file hashes
    per_file_sha256 = {}
    for fname, content in file_contents.items():
        per_file_sha256[fname] = {"source": calculate_hash(content, "sha256")}

    # Step 6: Apply allowed transformations
    changed_files = []
    # Transform package.json: only modify name and publishConfig.registry, preserve access:public
    new_pkg_data = original_pkg_data.copy()
    new_pkg_data["name"] = TARGET_PKG
    new_pkg_data["publishConfig"] = original_pkg_data.get("publishConfig", {}).copy()
    new_pkg_data["publishConfig"]["registry"] = "https://npm.pkg.github.com"
    new_pkg_bytes = json.dumps(
        new_pkg_data,
        ensure_ascii=False,
        indent=2
    ).encode("utf-8") + b"\n"
    file_contents[pkg_json_path] = new_pkg_bytes
    per_file_sha256[pkg_json_path]["target"] = calculate_hash(new_pkg_bytes, "sha256")
    changed_files.append(pkg_json_path)

    # Transform runtime files: byte-replace original package name
    for rpath in runtime_files:
        content = file_contents[rpath]
        new_content = content.replace(ORIGINAL_PKG.encode("utf-8"), TARGET_PKG.encode("utf-8"))
        if ORIGINAL_PKG.encode("utf-8") in new_content:
            raise ValueError(f"Leftover original package name in {rpath}")
        file_contents[rpath] = new_content
        per_file_sha256[rpath]["target"] = calculate_hash(new_content, "sha256")
        if new_content != content:
            changed_files.append(rpath)

    # Fill target hashes for unchanged files
    for fname in file_contents:
        if "target" not in per_file_sha256[fname]:
            per_file_sha256[fname]["target"] = per_file_sha256[fname]["source"]

    # Step 7: Write deterministic target tarball (zero timestamps)
    target_tar_path = os.path.join(output_dir, f"alice-marx-dsh-model-router-{version}.tgz")
    print(f"Writing target tarball to {target_tar_path}")
    with open(target_tar_path, "wb") as raw_out:
        with gzip.GzipFile(filename="", fileobj=raw_out, mode="wb", compresslevel=9, mtime=0) as gz_out:
            with tarfile.open(fileobj=gz_out, mode="w") as tar_out:
                for member in members:
                    new_member = tarfile.TarInfo(member.name)
                    new_member.mtime = 0
                    new_member.mode = member.mode
                    new_member.uid = 0
                    new_member.gid = 0
                    new_member.uname = ""
                    new_member.gname = ""
                    new_member.size = len(file_contents[member.name])
                    tar_out.addfile(new_member, io.BytesIO(file_contents[member.name]))

    # Calculate target tarball hashes
    target_sha256 = calculate_file_hash(target_tar_path, "sha256")
    target_integrity = "sha512-" + base64.b64encode(hashlib.sha512(open(target_tar_path, "rb").read()).digest()).decode("ascii")
    print(f"Target tarball SHA256: {target_sha256}")
    print(f"Target tarball SHA512: {target_integrity}")

    # Step 8: Write evidence (no private data)
    evidence = {
        "source_sha256": source_sha256,
        "source_integrity": expected_sha512,
        "target_sha256": target_sha256,
        "target_integrity": target_integrity,
        "per_file_sha256": per_file_sha256,
        "changed_files": sorted(changed_files),
        "source_manifest": original_pkg_data,
        "target_manifest": new_pkg_data
    }
    evidence_path = os.path.join(output_dir, "evidence.json")
    with open(evidence_path, "w", encoding="utf-8") as f:
        json.dump(evidence, f, indent=2, ensure_ascii=False)
    print(f"Evidence written to {evidence_path}")

    # Step 9: Verify output tarball correctness
    print("Verifying output tarball...")
    with tarfile.open(target_tar_path, "r:gz") as tar_verify:
        verify_members = tar_verify.getmembers()
        if len(verify_members) != len(members):
            raise ValueError(f"Member count mismatch: expected {len(members)}, got {len(verify_members)}")
        for i, (orig_member, verify_member) in enumerate(zip(members, verify_members)):
            if orig_member.name != verify_member.name:
                raise ValueError(f"Member name mismatch at index {i}: {orig_member.name} != {verify_member.name}")
            if orig_member.mode != verify_member.mode:
                raise ValueError(f"Member mode mismatch for {orig_member.name}")
            verify_content = tar_verify.extractfile(verify_member).read()
            expected_content = file_contents[orig_member.name]
            if verify_content != expected_content:
                raise ValueError(f"Content mismatch for {orig_member.name}")
            # Validate transformed files
            if orig_member.name == pkg_json_path:
                verify_pkg = json.loads(verify_content.decode("utf-8"))
                if verify_pkg.get("name") != TARGET_PKG:
                    raise ValueError(f"Target package name invalid: {verify_pkg.get('name')}")
                if verify_pkg.get("publishConfig", {}).get("registry") != "https://npm.pkg.github.com":
                    raise ValueError("Target publishConfig.registry invalid")
                if "access" in original_pkg_data.get("publishConfig", {}) and verify_pkg.get("publishConfig", {}).get("access") != "public":
                    raise ValueError("Lost access:public in target package.json")
                # Validate unchanged fields
                for key, value in original_pkg_data.items():
                    if key in ("name", "publishConfig"):
                        continue
                    if verify_pkg.get(key) != value:
                        raise ValueError(f"Package.json field {key} mismatch: {verify_pkg.get(key)} != {value}")
                orig_publish = original_pkg_data.get("publishConfig", {})
                target_publish = verify_pkg.get("publishConfig", {})
                for key, value in orig_publish.items():
                    if key == "registry":
                        continue
                    if target_publish.get(key) != value:
                        raise ValueError(f"PublishConfig field {key} mismatch: {target_publish.get(key)} != {value}")
            elif orig_member.name in runtime_files:
                if ORIGINAL_PKG.encode("utf-8") in verify_content:
                    raise ValueError(f"Leftover original package name in {orig_member.name} after transformation")
                if verify_content != expected_content:
                    raise ValueError(f"Runtime file {orig_member.name} content mismatch")
    print("Output tarball verification passed!")
    print("Prepare completed successfully!")

def cmd_verify(args):
    """Verify published tarball matches local prepared tarball byte-for-byte (semantic content, ignores gzip container differences)."""
    local_tarball = args.local_tarball
    published_tarball = args.verify_against
    if not os.path.exists(local_tarball):
        raise ValueError(f"Local tarball not found: {local_tarball}")
    if not os.path.exists(published_tarball):
        raise ValueError(f"Published tarball not found: {published_tarball}")
    print(f"Comparing local tarball {local_tarball} with published {published_tarball}")

    def extract_tar(tar_path):
        with open(tar_path, "rb") as f:
            buffer = io.BytesIO(f.read())
        with tarfile.open(fileobj=buffer, mode="r:gz") as tar:
            members = []
            contents = {}
            for member in tar.getmembers():
                if not member.isreg():
                    raise ValueError(f"Non-regular entry in tarball {tar_path}: {member.name}")
                if member.name in contents:
                    raise ValueError("Duplicate published tar entry")
                content = tar.extractfile(member).read()
                members.append(member)
                contents[member.name] = content
            return members, contents

    local_members, local_contents = extract_tar(local_tarball)
    pub_members, pub_contents = extract_tar(published_tarball)

    if len(local_members) != len(pub_members):
        raise ValueError(f"Member count mismatch: local {len(local_members)}, published {len(pub_members)}")
    local_modes = {m.name: m.mode for m in local_members}
    pub_modes = {m.name: m.mode for m in pub_members}
    if local_modes != pub_modes or local_contents != pub_contents:
        raise ValueError("Published archive filenames, modes or bytes differ from the prepared archive")
    print("Tarball verification passed! Local and published packages are identical.")

def main():
    parser = argparse.ArgumentParser(description="Prepare GitHub Package from npm tarball")
    subparsers = parser.add_subparsers(dest="command", required=True)
    # Prepare subcommand
    prepare_parser = subparsers.add_parser("prepare", help="Prepare package for GitHub Packages")
    prepare_parser.add_argument("--version", required=True, help="Stable version x.y.z")
    prepare_parser.add_argument("--output-dir", default=".", help="Output directory for artifacts")
    # Verify subcommand
    verify_parser = subparsers.add_parser("verify", help="Verify published package against local prepared tarball")
    verify_parser.add_argument("--verify-against", required=True, help="Path to published tarball")
    verify_parser.add_argument("--local-tarball", required=True, help="Path to local prepared tarball")

    args = parser.parse_args()
    if args.command == "prepare":
        cmd_prepare(args)
    elif args.command == "verify":
        cmd_verify(args)
    else:
        parser.print_help()
        sys.exit(1)

if __name__ == "__main__":
    main()