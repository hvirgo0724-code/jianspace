"""Fetch a small CC0 PBR/HDR set from Poly Haven, with upstream checksum checks.

Explicit development tool. The shipped browser uses only these local files.
Existing manifest entries and previously curated assets are preserved.
"""
import hashlib
import json
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "apps/web/public/visuals"
CURATED = {
    "roof_tiles_14": [("nor_gl", "jpg", "textures/roof-normal.jpg"),
                      ("Rough", "jpg", "textures/roof-roughness.jpg")],
    "plastered_wall_02": [("nor_gl", "jpg", "textures/plaster-normal.jpg"),
                          ("Rough", "jpg", "textures/plaster-roughness.jpg")],
    "kiara_1_dawn": [("hdri", "hdr", "lighting/daylight.hdr")],
    "kloppenheim_06_puresky": [("hdri", "hdr", "lighting/sky.hdr")],
    "lebombo": [("hdri", "hdr", "lighting/interior.hdr")],
}


def main():
    path = DEST / "manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    with httpx.Client(timeout=60, follow_redirects=True,
                      headers={"User-Agent": "JianSpace/0.2 curated-render-assets"}) as client:
        for asset, maps in CURATED.items():
            info_response = client.get(f"https://api.polyhaven.com/info/{asset}")
            files_response = client.get(f"https://api.polyhaven.com/files/{asset}")
            info_response.raise_for_status()
            files_response.raise_for_status()
            info, files = info_response.json(), files_response.json()
            for kind, extension, relative in maps:
                resource = files[kind]["1k"][extension]
                target = DEST / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                data = target.read_bytes() if target.exists() else client.get(resource["url"]).raise_for_status().content
                if len(data) > 4 * 1024 * 1024:
                    raise ValueError("Curated per-file size exceeded")
                if hashlib.md5(data).hexdigest() != resource["md5"]:
                    raise ValueError(f"Checksum mismatch: {relative}")
                target.write_bytes(data)
                entry = {
                    "file": relative, "bytes": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                    "url": resource["url"], "source": f"https://polyhaven.com/a/{asset}",
                    "license": "CC0-1.0", "author": ", ".join(info["authors"]),
                }
                manifest["assets"] = [e for e in manifest["assets"] if e["file"] != relative]
                manifest["assets"].append(entry)
                print(relative, len(data))
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
