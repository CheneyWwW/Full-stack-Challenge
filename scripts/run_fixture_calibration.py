"""Reproduce fixture-based v0/v1 calibration without an API key."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def main() -> None:
    commands = [
        [
            sys.executable,
            "-m",
            "adint",
            "batch",
            "--spec",
            "data/factors/phone_accessories_v0.yaml",
            "--provider",
            "fixture",
            "--fixture-dir",
            "fixtures/judgments",
            "--out",
            "outputs/predictions.csv",
        ],
        [
            sys.executable,
            "-m",
            "adint",
            "batch",
            "--spec",
            "data/factors/phone_accessories_v1.yaml",
            "--provider",
            "fixture",
            "--fixture-dir",
            "fixtures/judgments_v1",
            "--out",
            "outputs/predictions_v1.csv",
        ],
        [
            sys.executable,
            "scripts/evaluate_calibration.py",
            "--format",
            "table",
        ],
    ]
    Path("outputs").mkdir(exist_ok=True)
    for command in commands:
        print("\n$ " + " ".join(command), flush=True)
        subprocess.run(command, check=True)


if __name__ == "__main__":
    main()
