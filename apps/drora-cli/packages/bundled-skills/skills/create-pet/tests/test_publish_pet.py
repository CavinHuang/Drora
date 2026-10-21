import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

SKILL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL / "scripts"))
SPEC = importlib.util.spec_from_file_location("publish_pet", SKILL / "scripts/publish_pet.py")
PUBLISHER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PUBLISHER)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def create_reviewed_run(run):
    """Synthetic processing fixture, never an approved generated character."""
    (run / "final").mkdir(parents=True)
    (run / "qa/previews").mkdir(parents=True)
    atlas = Image.new("RGBA", (1536, 2288), (0, 0, 0, 0))
    draw = ImageDraw.Draw(atlas)
    # Codex hatch-pet v2 在 (0,6) 存储额外 neutral，独立于六帧 idle 动画。
    for row, count in enumerate([7, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8]):
        for column in range(count):
            x, y = column * 192, row * 208
            draw.ellipse((x + 48, y + 36, x + 144, y + 180), fill=(30, 90, 180, 255))
    atlas.save(run / "final/spritesheet.webp", lossless=True)
    atlas.resize((384, 572)).save(run / "qa/contact-sheet.png")
    atlas.crop((0, 1872, 1536, 2288)).save(run / "qa/look-directions.png")
    frame = atlas.crop((0, 0, 192, 208))
    for state in ("idle", "running-right", "running-left", "waving", "jumping",
                  "failed", "waiting", "running", "review"):
        frame.save(run / f"qa/previews/{state}.gif")
    write_json(run / "pet_request.json", {
        "pet_id": "test-pet", "display_name": "Test pet", "description": "Synthetic test only",
        "sprite_version_number": 2, "chroma_key": {"hex": "#FF00FF"},
    })
    for name in ("review", "despill-report", "look-continuity"):
        write_json(run / f"qa/{name}.json", {"ok": True, "errors": [], "warnings": []})
    write_json(run / "qa/direction-semantics.json", {"directions": {
        degree: {"verdict": "pass", "expected": degree, "observed": "test fixture",
                 "reason": "Publisher boundary fixture, not a visual acceptance claim"}
        for degree in PUBLISHER.DIRECTIONS
    }})
    write_json(run / "qa/visual-review.json", {
        "approved": True, "reviewer": "test fixture", "notes": "Synthetic processing test",
        "atlas_sha256": hashlib.sha256((run / "final/spritesheet.webp").read_bytes()).hexdigest(),
    })


class PublishPetTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="drora-pet-publish-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.run = self.root / "run"
        self.pets = self.root / "home/.drora/pets"
        create_reviewed_run(self.run)

    def test_publishes_loadable_manifest_and_reuses_verified_receipt(self):
        receipt = PUBLISHER.publish(self.run, self.pets)
        self.assertEqual(receipt["id"], "custom:test-pet")
        directory = Path(receipt["directory"])
        manifest = json.loads((directory / "pet.json").read_text())
        self.assertEqual(manifest["spriteVersionNumber"], 2)
        self.assertEqual(set(path.name for path in directory.iterdir()), {"pet.json", "spritesheet.webp"})
        self.assertEqual(PUBLISHER.publish(self.run, self.pets), receipt)
        self.assertEqual(len(list(self.pets.iterdir())), 1)

    def test_collision_preserves_existing_pet_including_case_variants(self):
        existing = self.pets / "TEST-PET"
        existing.mkdir(parents=True)
        (existing / "keep.txt").write_text("preserve")
        receipt = PUBLISHER.publish(self.run, self.pets)
        self.assertEqual(receipt["id"], "custom:test-pet-2")
        self.assertEqual((existing / "keep.txt").read_text(), "preserve")

    def test_rejects_stale_visual_approval_before_installing(self):
        write_json(self.run / "qa/visual-review.json", {"approved": True, "atlas_sha256": "0" * 64})
        with self.assertRaisesRegex(ValueError, "different atlas bytes"):
            PUBLISHER.publish(self.run, self.pets)
        self.assertFalse(self.pets.exists())

    def test_rejects_failed_or_incomplete_direction_review(self):
        for value in ({"directions": {}}, {"directions": {key: {"verdict": "fail"}
                                                        for key in PUBLISHER.DIRECTIONS}}):
            write_json(self.run / "qa/direction-semantics.json", value)
            with self.assertRaises(ValueError):
                PUBLISHER.publish(self.run, self.pets)
        self.assertFalse(self.pets.exists())

    def test_rejects_missing_artifact_failed_processing_and_v1(self):
        write_json(self.run / "qa/despill-report.json", {"ok": False})
        with self.assertRaisesRegex(ValueError, "Failed QA"):
            PUBLISHER.publish(self.run, self.pets)
        write_json(self.run / "qa/despill-report.json", {"ok": True})
        (self.run / "qa/previews/jumping.gif").unlink()
        with self.assertRaises(FileNotFoundError):
            PUBLISHER.publish(self.run, self.pets)
        request = json.loads((self.run / "pet_request.json").read_text())
        request["sprite_version_number"] = 1
        write_json(self.run / "pet_request.json", request)
        with self.assertRaisesRegex(ValueError, "version 2"):
            PUBLISHER.publish(self.run, self.pets)

    def test_rejects_codex_and_relative_destinations(self):
        for path in (self.root / ".codex/pets", Path("relative/.drora/pets")):
            with self.assertRaises(ValueError):
                PUBLISHER.publish(self.run, path)
        self.assertFalse((self.root / ".codex").exists())

    def test_rejects_opaque_atlas_even_with_matching_visual_approval(self):
        image = self.run / "final/spritesheet.webp"
        Image.new("RGB", (1536, 2288), "blue").save(image, lossless=True)
        review = json.loads((self.run / "qa/visual-review.json").read_text())
        review["atlas_sha256"] = hashlib.sha256(image.read_bytes()).hexdigest()
        write_json(self.run / "qa/visual-review.json", review)
        with self.assertRaisesRegex(ValueError, "Atlas validation failed"):
            PUBLISHER.publish(self.run, self.pets)
        self.assertFalse(self.pets.exists())

    def test_retry_preserves_a_published_pet_changed_by_the_user(self):
        receipt = PUBLISHER.publish(self.run, self.pets)
        (Path(receipt["directory"]) / "pet.json").write_text('{"displayName":"User edit"}')
        with self.assertRaisesRegex(ValueError, "Previously published pet changed"):
            PUBLISHER.publish(self.run, self.pets)
        self.assertEqual(len(list(self.pets.iterdir())), 1)


if __name__ == "__main__":
    unittest.main()
