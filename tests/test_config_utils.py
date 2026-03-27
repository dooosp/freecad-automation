"""Lightweight regression checks for config normalization helpers."""

import os
import sys


THIS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(THIS_DIR)
sys.path.insert(0, os.path.join(ROOT_DIR, "scripts"))

from _config_utils import normalize_config


def main():
    raw = {
        "operations": [{"type": "fuse", "base": "a", "tool": "b"}],
        "parts": [
            {
                "id": "child",
                "shapes": [{"id": "body", "type": "box"}],
                "operations": [{"type": "cut", "base": "body", "tool": "body"}],
            }
        ],
    }

    normalized = normalize_config(raw)

    assert "op" not in raw["operations"][0], "normalize_config should not mutate the source config"
    assert normalized["operations"][0]["op"] == "fuse"
    assert normalized["parts"][0]["operations"][0]["op"] == "cut"
    assert normalized["parts"][0]["shapes"][0]["type"] == "box"

    print("test_config_utils.py: ok")


if __name__ == "__main__":
    main()
