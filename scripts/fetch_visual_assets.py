"""Fetch the curated, licensed runtime assets and record source checksums.

Run explicitly while developing; the app itself never calls a third-party asset API.
"""

import hashlib, json, sys
from pathlib import Path
import httpx

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "apps/web/public/visuals"
sys.stdout.reconfigure(encoding="utf-8")


def main():
    manifest = []
    with httpx.Client(
        timeout=90,
        follow_redirects=True,
        headers={"User-Agent": "JianSpace/0.2 (curated-asset-build)"},
    ) as client:

        def fetch(url, path, source, license, author, expected_md5=None):
            path = DEST / path
            if not path.resolve().is_relative_to(DEST.resolve()):
                raise ValueError("Invalid asset path")
            path.parent.mkdir(parents=True, exist_ok=True)
            if path.exists():
                data = path.read_bytes()
            else:
                response = client.get(url)
                response.raise_for_status()
                data = response.content
                if len(data) > 20 * 1024 * 1024:
                    raise ValueError("Asset exceeds curated size budget")
            if expected_md5 and hashlib.md5(data).hexdigest() != expected_md5:
                raise ValueError("Asset checksum changed: " + url)
            path.write_bytes(data)
            manifest.append(
                {
                    "file": path.relative_to(DEST).as_posix(),
                    "bytes": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                    "url": url,
                    "source": source,
                    "license": license,
                    "author": author,
                }
            )
            print(path.name, len(data))

        for name, license, author in [
            ("GlamVelvetSofa", "CC-BY-4.0", "© 2021 Wayfair, LLC; Eric Chadwick"),
            ("SheenChair", "CC0-1.0", "© 2020 Wayfair, LLC; Eric Chadwick"),
        ]:
            base = f"https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/{name}"
            fetch(
                f"{base}/glTF-Binary/{name}.glb",
                Path("models") / (name + ".glb"),
                f"https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/{name}",
                license,
                author,
            )
            fetch(
                f"{base}/README.md",
                Path("licenses") / (name + ".md"),
                f"{base}/README.md",
                license,
                author,
            )
        for name, author in [
            ("modern_coffee_table_02", "Amin"),
            ("modern_wooden_cabinet", "Patrik Pangerl"),
            ("sofa_03", "Fran Calvente"),
            ("dining_table", "Aron Łyczek"),
        ]:
            info = client.get("https://api.polyhaven.com/files/" + name)
            info.raise_for_status()
            entry = info.json()["gltf"]["1k"]["gltf"]
            source = "https://polyhaven.com/a/" + name
            fetch(
                entry["url"],
                Path("models") / name / "scene.gltf",
                source,
                "CC0-1.0",
                author,
                entry.get("md5"),
            )
            for relative, resource in entry["include"].items():
                fetch(
                    resource["url"],
                    Path("models") / name / relative,
                    source,
                    "CC0-1.0",
                    author,
                    resource.get("md5"),
                )
        data = client.get("https://api.polyhaven.com/files/wood_floor")
        data.raise_for_status()
        textures = data.json()["gltf"]["1k"]["gltf"]["include"]
        for suffix, target in [
            ("diff", "wood-color.jpg"),
            ("nor_gl", "wood-normal.jpg"),
            ("arm", "wood-arm.jpg"),
        ]:
            resource = next(v for k, v in textures.items() if f"_{suffix}_" in k)
            fetch(
                resource["url"],
                Path("textures") / target,
                "https://polyhaven.com/a/wood_floor",
                "CC0-1.0",
                "Dimitrios Savva",
                resource.get("md5"),
            )
        data = client.get("https://api.polyhaven.com/files/studio_small_09")
        data.raise_for_status()
        resource = data.json()["hdri"]["1k"]["hdr"]
        fetch(
            resource["url"],
            Path("lighting/studio.hdr"),
            "https://polyhaven.com/a/studio_small_09",
            "CC0-1.0",
            "Sergej Majboroda",
            resource.get("md5"),
        )
    existing_path = DEST / "manifest.json"
    existing = json.loads(existing_path.read_text(encoding="utf-8")) if existing_path.exists() else {"assets": []}
    refreshed = {entry["file"] for entry in manifest}
    manifest.extend(entry for entry in existing["assets"] if entry["file"] not in refreshed)
    existing_path.write_text(
        json.dumps({"version": 1, "assets": manifest}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
