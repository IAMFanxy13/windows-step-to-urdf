import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


def triangle_stl() -> bytes:
    return b"mirror test".ljust(80, b"\0") + struct.pack(
        "<I12fH", 1,
        0, 0, 1,
        0, 0, 0,
        0.1, 0, 0,
        0, 0.1, 0,
        0,
    )


class MeshVariantTests(unittest.TestCase):
    def test_bakes_local_x_reflection_and_repairs_triangle_winding(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, target = root / "source.stl", root / "mirrored.stl"
            source.write_bytes(triangle_stl())
            script = Path(__file__).parents[1] / "scripts" / "mesh_variants.py"
            result = subprocess.run([sys.executable, str(script), str(source), str(target), "--axis", "x"], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            data = target.read_bytes()
            values = struct.unpack_from("<12f", data, 84)
            self.assertAlmostEqual(values[2], 1.0)
            self.assertEqual(tuple(round(value, 6) for value in values[3:6]), (0.0, 0.0, 0.0))
            self.assertEqual(tuple(round(value, 6) for value in values[6:9]), (0.0, 0.1, 0.0))
            self.assertEqual(tuple(round(value, 6) for value in values[9:12]), (-0.1, 0.0, 0.0))


if __name__ == "__main__":
    unittest.main()
