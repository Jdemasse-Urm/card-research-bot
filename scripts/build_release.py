"""Build the two download zips for GitHub Releases (maintainers only).

    python scripts/build_release.py <node-downloads-dir> <out-dir>

<node-downloads-dir> must hold the official, checksum-verified Node.js builds for NODE_VERSION:
    node-vX-win-x64.zip, node-vX-darwin-arm64.tar.gz, node-vX-darwin-x64.tar.gz
Each zip = the committed app (git archive HEAD) + production node_modules + its own Node.js runtime,
so neither Windows nor Mac users have to install anything.
Python is used (not Node) because zipfile can record Unix permissions: the Mac launcher and
Node binaries must stay executable after macOS unzips them.
"""
import io, json, os, pathlib, shutil, subprocess, sys, tarfile, tempfile, zipfile

NODE_VERSION = "v22.23.3"
ROOT = pathlib.Path(__file__).resolve().parent.parent
NODE_DIR, OUT = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]

QUICKSTART = {
    "Windows": """CARD RESEARCH BOT {v} — WINDOWS

1. Double-click  start-windows.bat
   (If Windows shows "Windows protected your PC": click "More info" -> "Run anyway".)
2. Your browser opens the bot. Click Settings and paste your free Gemini key
   from https://aistudio.google.com/apikey , then click "Run self-test".
3. Keep the black window open while you use the bot. Close it to stop.

Everything is included (Node.js too) — nothing to install.
Your data lives in the "data" folder inside this folder. To update later, unzip the new
version and copy your old "data" folder and ".env" file into it.
""",
    "Mac": """CARD RESEARCH BOT {v} — MAC (Apple Silicon and Intel, macOS 11 or newer)

1. Right-click (or Control-click)  start-mac.command  ->  Open  ->  Open.
   (Only the first time. After that you can just double-click it.)
2. Your browser opens the bot. Click Settings and paste your free Gemini key
   from https://aistudio.google.com/apikey , then click "Run self-test".
3. Keep the Terminal window open while you use the bot. Close it to stop.

Everything is included (Node.js too) — nothing to install.
If macOS says the file "cannot be opened" or you "don't have permission": open Terminal, type
   chmod +x   (with a space after it), drag start-mac.command into the window, press Enter, then try again.
Your data lives in the "data" folder inside this folder. To update later, unzip the new
version and copy your old "data" folder and ".env" file into it.
""",
}


def sh(*cmd, cwd=None):
    subprocess.run(cmd, cwd=cwd, check=True, shell=(os.name == "nt" and cmd[0] == "npm"))


def stage_app(tmp):
    """Committed files only (no .env, no data, no dev clutter) + production dependencies."""
    app = tmp / "app"
    app.mkdir()
    archive = subprocess.run(["git", "archive", "--format=tar", "HEAD"], cwd=ROOT, check=True, capture_output=True).stdout
    with tarfile.open(fileobj=io.BytesIO(archive)) as t:
        t.extractall(app, filter="data")
    sh("npm", "ci", "--omit=dev", "--no-fund", "--no-audit", "--ignore-scripts", cwd=app)
    native = [p for p in app.rglob("*.node")]
    if native:
        sys.exit(f"native modules found, the bundle would not be cross-platform: {native}")
    return app


def add_tree(z, src, prefix, skip=(), exec_names=()):
    for p in sorted(src.rglob("*")):
        rel = p.relative_to(src).as_posix()
        if p.is_dir() or rel.split("/")[0] in skip or rel in skip:
            continue
        info = zipfile.ZipInfo(f"{prefix}/{rel}", date_time=(2026, 10, 19, 12, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        mode = 0o755 if rel in exec_names else 0o644
        info.external_attr = (0o100000 | mode) << 16
        z.writestr(info, p.read_bytes())


def add_bytes(z, name, data, executable=False):
    info = zipfile.ZipInfo(name, date_time=(2026, 10, 19, 12, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = (0o100000 | (0o755 if executable else 0o644)) << 16
    z.writestr(info, data)


def build_windows(app):
    name = f"CardResearchBot-{version}-Windows"
    out = OUT / f"{name}.zip"
    with zipfile.ZipFile(NODE_DIR / f"node-{NODE_VERSION}-win-x64.zip") as nz:
        node_exe = nz.read(f"node-{NODE_VERSION}-win-x64/node.exe")
        node_license = nz.read(f"node-{NODE_VERSION}-win-x64/LICENSE")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        add_tree(z, app, name, skip=("start-mac.command", "scripts"))
        add_bytes(z, f"{name}/runtime/node.exe", node_exe, executable=True)
        add_bytes(z, f"{name}/runtime/NODE-LICENSE.txt", node_license)
        add_bytes(z, f"{name}/README-FIRST.txt", QUICKSTART["Windows"].format(v=version).replace("\n", "\r\n").encode())
    return out


def build_mac(app):
    name = f"CardResearchBot-{version}-Mac"
    out = OUT / f"{name}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        add_tree(z, app, name, skip=("start-windows.bat", "scripts"), exec_names=("start-mac.command",))
        for arch in ("arm64", "x64"):
            base = f"node-{NODE_VERSION}-darwin-{arch}"
            with tarfile.open(NODE_DIR / f"{base}.tar.gz") as t:
                add_bytes(z, f"{name}/runtime/darwin-{arch}/node", t.extractfile(f"{base}/bin/node").read(), executable=True)
                if arch == "arm64":
                    add_bytes(z, f"{name}/runtime/NODE-LICENSE.txt", t.extractfile(f"{base}/LICENSE").read())
        add_bytes(z, f"{name}/README-FIRST.txt", QUICKSTART["Mac"].format(v=version).encode())
    return out


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as d:
        app = stage_app(pathlib.Path(d))
        for f in (build_windows(app), build_mac(app)):
            print(f"{f}  {f.stat().st_size / 1e6:.1f} MB")
