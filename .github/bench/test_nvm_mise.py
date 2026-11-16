import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


class NvmBootstrapTest(unittest.TestCase):
    def test_installer_receives_existing_custom_nvm_directory(self):
        with tempfile.TemporaryDirectory(prefix="nvm-mise-harness-") as temp:
            root = Path(temp)
            (root / "project").mkdir()
            (root / "data/home").mkdir(parents=True)
            with patch.dict(os.environ, {"BENCH_ROOT": temp, "BENCH_TOOL": "nvm"}):
                source = Path(__file__).with_name("nvm-mise.py").read_text()
                namespace = {}
                exec(compile(source.split("mode = sys.argv[1]")[0], source, "exec"), namespace)

            def installer_stub(url, target, checksum):
                # Reproduce the real installer's custom-NVM_DIR precondition.
                target.write_text('test -d "$NVM_DIR" || exit 1\n')

            namespace["download"] = installer_stub
            namespace["bootstrap"]()
            self.assertTrue((root / "data/nvm").is_dir())


if __name__ == "__main__":
    unittest.main()
