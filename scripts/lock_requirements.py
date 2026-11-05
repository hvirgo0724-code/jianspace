import subprocess, sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
raw = subprocess.check_output([sys.executable, "-m", "pip", "freeze"], text=True)
lines = [line for line in raw.splitlines() if not line.lower().startswith("ruff==")]
(root / "apps/api/requirements.lock.txt").write_text(
    "\n".join(lines) + "\n", encoding="utf-8"
)
print("Locked", len(lines), "Python dependencies")
