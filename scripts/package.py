"""Package the built extension; only maintainers need Python/Node.js."""
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

root = Path(__file__).resolve().parent.parent
dist = root / "dist"
manifest = json.loads((dist / "manifest.json").read_text())
package = json.loads((root / "package.json").read_text())
if manifest["version"] != package["version"]:
    raise SystemExit("package.json and manifest.json versions must match")

required = ["manifest.json", "index.html", manifest["background"]["service_worker"]]
required += [name for entry in manifest["content_scripts"] for name in entry["js"]]
if any(not (dist / name).is_file() for name in required):
    raise SystemExit("Missing extension files; run npm run build first")

files = sorted(path for path in dist.rglob("*") if path.is_file())
if any(path.is_symlink() or dist.resolve() not in path.resolve().parents for path in files):
    raise SystemExit("Distribution files must be regular files inside dist")

output = root / "downloads" / "tenfour-analyzer.zip"
output.parent.mkdir(exist_ok=True)
with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
    entries = [(path, path.relative_to(dist).as_posix()) for path in files]
    entries.append((root / "README.md", "README.md"))
    for path, name in entries:
        # Fixed metadata keeps identical builds byte-for-byte reproducible.
        info = ZipInfo("tenfour-analyzer/" + name, date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        archive.writestr(info, path.read_bytes())
    if archive.testzip() is not None:
        raise SystemExit("Archive verification failed")
print(f"Created {output.relative_to(root)} ({output.stat().st_size:,} bytes)")
