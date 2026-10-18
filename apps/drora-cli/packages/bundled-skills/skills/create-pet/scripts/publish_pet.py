#!/usr/bin/env python3
"""Publish a reviewed v2 run to an explicit local Drora pet library."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_REPORT_BYTES = 1024 * 1024
DIRECTIONS = (
    "000", "022.5", "045", "067.5", "090", "112.5", "135", "157.5",
    "180", "202.5", "225", "247.5", "270", "292.5", "315", "337.5",
)
REQUIRED_HELPERS = (
    "prepare_pet_run.py", "extract_strip_frames.py", "inspect_frames.py",
    "compose_atlas.py", "extract_cardinal_anchors.py", "compose_cardinal_anchor_strip.py",
    "assemble_extended_atlas.py", "despill_chroma_edges.py", "validate_atlas.py",
    "make_contact_sheet.py", "make_direction_qa_sheet.py", "measure_direction_continuity.py",
    "render_animation_previews.py",
)


def owned_file(root: Path, relative: str) -> Path:
    path = (root / relative).resolve(strict=True)
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError(f"Run artifact escapes its directory: {relative}")
    return path


def read_report(root: Path, relative: str) -> dict:
    path = owned_file(root, relative)
    if path.stat().st_size > MAX_REPORT_BYTES:
        raise ValueError(f"Report exceeds limit: {relative}")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Report must be an object: {relative}")
    return value


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def check_review(run: Path, image_hash: str) -> None:
    warnings = False
    for name in ("review", "despill-report", "look-continuity"):
        report = read_report(run, f"qa/{name}.json")
        if report.get("ok") is not True or report.get("errors"):
            raise ValueError(f"Failed QA: {name}")
        warnings = warnings or bool(report.get("warnings"))
    for name in ("contact-sheet.png", "look-directions.png"):
        owned_file(run, f"qa/{name}")
    for state in ("idle", "running-right", "running-left", "waving", "jumping",
                  "failed", "waiting", "running", "review"):
        owned_file(run, f"qa/previews/{state}.gif")
    directions = read_report(run, "qa/direction-semantics.json").get("directions", {})
    if not isinstance(directions, dict) or set(directions) != set(DIRECTIONS):
        raise ValueError("Direction review must cover all sixteen directions")
    for degree, verdict in directions.items():
        if not isinstance(verdict, dict) or verdict.get("verdict") not in ("pass", "warning"):
            raise ValueError(f"Failed direction review: {degree}")
        if any(not isinstance(verdict.get(key), str) or not verdict[key].strip()
               for key in ("expected", "observed", "reason")):
            raise ValueError(f"Incomplete direction review: {degree}")
        warnings = warnings or verdict["verdict"] == "warning"
    visual = read_report(run, "qa/visual-review.json")
    if visual.get("approved") is not True or visual.get("atlas_sha256") != image_hash:
        raise ValueError("Visual approval is missing or belongs to different atlas bytes")
    if any(not isinstance(visual.get(key), str) or not visual[key].strip()
           for key in ("reviewer", "notes")):
        raise ValueError("Visual review needs its reviewer and actual observations")
    if warnings and visual.get("warnings_reviewed") is not True:
        raise ValueError("QA warnings have not been reviewed")


def validate_bytes(run: Path, data: bytes, chroma: str) -> None:
    report_path = run / "qa/atlas-validation.json"
    if report_path.is_symlink() or not report_path.resolve().is_relative_to(run):
        raise ValueError("Atlas validation report escapes its run")
    # 校验临时副本并发布同一份 bytes，避免校验后源文件被改动而安装未经验证的图片。
    with tempfile.TemporaryDirectory(prefix=".pet-validation-", dir=run) as temporary:
        snapshot = Path(temporary) / "spritesheet.webp"
        snapshot.write_bytes(data)
        result = subprocess.run(
            [sys.executable, "-B", str(Path(__file__).with_name("validate_atlas.py")),
             str(snapshot), "--require-v2", "--chroma-key", chroma,
             "--json-out", str(report_path)],
            capture_output=True, text=True, timeout=120, check=False,
        )
        report = read_report(run, "qa/atlas-validation.json")
        if result.returncode != 0 or report.get("ok") is not True:
            raise ValueError(f"Atlas validation failed: {report.get('errors', [])}")
        # 持久报告绑定发布的内容，不能把已删除的临时校验路径当作最终产物。
        report["file"] = str(run / "final/spritesheet.webp")
        report["atlas_sha256"] = digest(data)
        report_path.write_text(
            json.dumps(report, indent=2) + "\n", encoding="utf-8")


def publish(run: Path, pets_root: Path, folder: str | None = None) -> dict:
    run = run.resolve(strict=True)
    if not pets_root.is_absolute():
        raise ValueError("Use the absolute local library path supplied by Drora")
    if pets_root.name.casefold() != "pets" or pets_root.parent.name.casefold() != ".drora":
        raise ValueError("Destination must be the explicitly configured Drora .drora/pets root")
    if pets_root.is_symlink() or pets_root.parent.is_symlink():
        raise ValueError("Do not publish through a symlinked pet root")
    missing = [name for name in REQUIRED_HELPERS if not Path(__file__).with_name(name).is_file()]
    if missing:
        raise ValueError(f"Incomplete create-pet skill: {missing}")
    image = owned_file(run, "final/spritesheet.webp")
    if image.stat().st_size > MAX_IMAGE_BYTES:
        raise ValueError("Spritesheet exceeds the desktop's 20 MiB limit")
    data = image.read_bytes()
    if len(data) > MAX_IMAGE_BYTES or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise ValueError("Expected a bounded final WebP spritesheet")
    request = read_report(run, "pet_request.json")
    if request.get("sprite_version_number") != 2:
        raise ValueError("New pets must declare sprite version 2")
    name = request.get("display_name")
    description = request.get("description")
    if not isinstance(name, str) or not name.strip() or not isinstance(description, str):
        raise ValueError("Prepared request needs a name and description")
    image_hash = digest(data)
    check_review(run, image_hash)
    chroma = request.get("chroma_key", {}).get("hex")
    if not isinstance(chroma, str) or not re.fullmatch(r"#[0-9A-Fa-f]{6}", chroma):
        raise ValueError("Prepared request needs its selected chroma key")
    validate_bytes(run, data, chroma)
    manifest = {"displayName": name.strip(), "description": description.strip(),
                "spriteVersionNumber": 2, "spritesheetPath": "spritesheet.webp"}
    pets_root.mkdir(parents=True, exist_ok=True)
    pets_root = pets_root.resolve(strict=True)
    if run.is_relative_to(pets_root) or pets_root.is_relative_to(run):
        raise ValueError("Keep the creation run separate from the installed library")
    receipt_path = run / "published-pet.json"
    if receipt_path.is_symlink():
        raise ValueError("Publishing receipt must belong to its run")
    if receipt_path.exists():
        receipt = read_report(run, "published-pet.json")
        if receipt.get("atlas_sha256") == image_hash and receipt.get("manifest") == manifest:
            recorded = Path(receipt["directory"])
            previous = recorded.resolve(strict=True)
            if (previous.parent != pets_root or recorded.is_symlink()
                    or receipt.get("id") != f"custom:{previous.name}"):
                raise ValueError("Published receipt does not belong to this pet root")
            if (digest(owned_file(previous, "spritesheet.webp").read_bytes()) != image_hash
                    or read_report(previous, "pet.json") != manifest):
                raise ValueError("Previously published pet changed; preserve it and review a new run")
            return receipt
    stem = re.sub(r"[^a-z0-9_-]+", "-", (folder or str(request.get("pet_id", "pet"))).lower())
    stem = stem.strip("-_")[:70] or "pet"
    if re.fullmatch(r"con|prn|aux|nul|com[1-9]|lpt[1-9]", stem):
        stem = "pet-" + stem
    suffix = 1
    while True:
        candidate = stem if suffix == 1 else f"{stem}-{suffix}"
        names = {path.name.casefold() for path in pets_root.iterdir()}
        destination = pets_root / candidate
        if candidate.casefold() not in names:
            try:
                destination.mkdir()
                break
            except FileExistsError:
                pass
        suffix += 1
    try:
        # 清单最后写入：扫描器不会在图集尚未落地时接纳半个新宠物。
        (destination / "spritesheet.webp").write_bytes(data)
        temporary_manifest = destination / ".pet.json"
        temporary_manifest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        temporary_manifest.replace(destination / "pet.json")
    except Exception:
        # destination 由上方独占创建，且父目录已经 resolve；只清理本次未完成的发布。
        shutil.rmtree(destination)
        raise
    receipt = {"id": f"custom:{candidate}", "directory": str(destination),
               "atlas_sha256": image_hash, "manifest": manifest}
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return receipt


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--pets-root", type=Path, required=True)
    parser.add_argument("--folder")
    args = parser.parse_args()
    print(json.dumps(publish(args.run_dir, args.pets_root, args.folder), indent=2))


if __name__ == "__main__":
    main()
