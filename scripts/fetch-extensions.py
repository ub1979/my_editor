#!/usr/bin/env python3
"""Downloads the extensions pinned in overlay/bundled-extensions.json from Open VSX, verifies each file's
sha256 against Open VSX, and unpacks them into a staging folder ready to copy into the app.

Usage: scripts/fetch-extensions.py <staging-dir>
"""
import hashlib
import json
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'vscodium' / '.bundled-cache'
API = 'https://open-vsx.org/api'


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read()


def main(staging: Path) -> None:
    pins = json.loads((ROOT / 'overlay' / 'bundled-extensions.json').read_text())['extensions']
    CACHE.mkdir(parents=True, exist_ok=True)
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    for pin in pins:
        namespace, name = pin['id'].split('.', 1)
        target = pin['target']
        meta_url = f"{API}/{namespace}/{name}/{target}/{pin['version']}" if target != 'universal' else f"{API}/{namespace}/{name}/{pin['version']}"
        meta = json.loads(fetch(meta_url))
        files = meta['files']
        expected = fetch(files['sha256']).decode().split()[0].strip().lower()
        vsix = CACHE / f"{pin['id']}-{pin['version']}-{target}.vsix"
        if not vsix.exists() or hashlib.sha256(vsix.read_bytes()).hexdigest() != expected:
            vsix.write_bytes(fetch(files['download']))
        actual = hashlib.sha256(vsix.read_bytes()).hexdigest()
        if actual != expected:
            sys.exit(f"{pin['id']}: sha256 mismatch ({actual} != {expected}); refusing to bundle it")
        destination = staging / pin['id']
        with zipfile.ZipFile(vsix) as archive:
            for member in archive.namelist():
                if not member.startswith('extension/') or member.endswith('/'):
                    continue
                relative = Path(member[len('extension/'):])
                if relative.is_absolute() or '..' in relative.parts:
                    sys.exit(f"{pin['id']}: unsafe path in package: {member}")
                out = destination / relative
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(archive.read(member))
                mode = (archive.getinfo(member).external_attr >> 16) & 0o777
                if mode:
                    out.chmod(mode)
        print(f"bundled {pin['id']} {pin['version']} ({target}) sha256 ok")


if __name__ == '__main__':
    main(Path(sys.argv[1]))
