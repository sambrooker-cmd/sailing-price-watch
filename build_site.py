"""Build the tracker dashboard for GitHub Pages: site/index.html plus the
latest price data, written to _site/ (deployed by the workflow).

Usage: python build_site.py [OUT_DIR]
"""
import json, shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RUNS_SHOWN = 21


def load(p):
    d = json.loads(Path(p).read_text())
    return d.get("data", d)


def main(out):
    out = Path(out)
    if out.exists():
        shutil.rmtree(out)
    (out / "data").mkdir(parents=True)
    shutil.copyfile(ROOT / "site" / "index.html", out / "index.html")
    for name in ("current", "cabins"):
        (out / "data" / f"{name}.json").write_text(
            json.dumps(load(ROOT / "state" / f"{name}.json"), ensure_ascii=False, separators=(",", ":")))
    runs = [load(p) for p in sorted((ROOT / "runs").glob("*.json"), reverse=True)[:RUNS_SHOWN]]
    (out / "data" / "runs.json").write_text(json.dumps(runs, ensure_ascii=False, separators=(",", ":")))
    print(f"built {out}: {len(runs)} runs")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ROOT / "_site")
