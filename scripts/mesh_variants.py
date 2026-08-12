"""Create right-handed binary-STL variants for reflected STEP occurrences."""

from __future__ import annotations

import argparse
import math
import struct
from pathlib import Path


def _reflect(point: tuple[float, float, float], axis: int) -> tuple[float, float, float]:
    result = list(point)
    result[axis] = -result[axis]
    return tuple(result)


def _normal(vertices: list[tuple[float, float, float]]) -> tuple[float, float, float]:
    left = tuple(vertices[1][index] - vertices[0][index] for index in range(3))
    right = tuple(vertices[2][index] - vertices[0][index] for index in range(3))
    value = (left[1] * right[2] - left[2] * right[1],
             left[2] * right[0] - left[0] * right[2],
             left[0] * right[1] - left[1] * right[0])
    length = math.sqrt(sum(item * item for item in value))
    return tuple(item / length for item in value) if length > 1e-15 else (0.0, 0.0, 0.0)


def bake_reflected_binary_stl(source: Path, target: Path, axis: int = 0) -> Path:
    if axis not in (0, 1, 2):
        raise ValueError("reflection axis must be 0, 1 or 2")
    data = source.read_bytes()
    if len(data) < 84:
        raise ValueError("source is not a binary STL")
    count = struct.unpack_from("<I", data, 80)[0]
    if count <= 0 or len(data) != 84 + count * 50:
        raise ValueError("source is not a non-empty binary STL")
    target.parent.mkdir(parents=True, exist_ok=True)
    header = b"STEP-to-URDF reflection-baked mesh".ljust(80, b"\0")
    with target.open("wb") as stream:
        stream.write(header)
        stream.write(struct.pack("<I", count))
        for index in range(count):
            values = struct.unpack_from("<12fH", data, 84 + index * 50)
            original = [tuple(values[offset:offset + 3]) for offset in (3, 6, 9)]
            reflected = [_reflect(point, axis) for point in original]
            reflected[1], reflected[2] = reflected[2], reflected[1]
            normal = _normal(reflected)
            stream.write(struct.pack("<12fH", *normal, *reflected[0], *reflected[1], *reflected[2], values[12]))
    return target


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("--axis", choices=("x", "y", "z"), default="x")
    args = parser.parse_args(argv)
    bake_reflected_binary_stl(args.source, args.target, {"x": 0, "y": 1, "z": 2}[args.axis])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
