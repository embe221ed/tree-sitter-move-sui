"""Exercise failure propagation without compiling a parser for every case."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
VERSION = json.loads((ROOT / "package.json").read_text())["devDependencies"]["tree-sitter-cli"]


class TestRunner(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="move-runner-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        shutil.copy(ROOT / "run-tests.sh", self.root)
        shutil.copy(ROOT / "package.json", self.root)
        (self.root / "tests").mkdir()
        (self.root / "tests" / "example.move").write_text("module a::b {}\n")
        self.bin = self.root / "bin"
        self.bin.mkdir()
        for command in ("cargo", "python3", "npm", "git"):
            self.executable(self.bin / command, "#!/bin/bash\nexit 0\n")
        cli = self.root / "node_modules" / ".bin" / "tree-sitter"
        cli.parent.mkdir(parents=True)
        self.executable(cli, '''#!/bin/bash
case "$1" in
  --version) echo "tree-sitter ${TEST_CLI_VERSION}" ;;
  parse)
    printf '%s\\n' "$@" > "$TEST_PARSE_ARGS"
    [ -z "$TEST_PARSE_STDERR" ] || printf '%s\\n' "$TEST_PARSE_STDERR" >&2
    [ -z "$TEST_PARSE_STDOUT" ] || printf '%s\\n' "$TEST_PARSE_STDOUT"
    exit "$TEST_PARSE_STATUS"
    ;;
esac
''')
        self.env = {
            **os.environ,
            "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
            "TEST_CLI_VERSION": VERSION,
            "TEST_PARSE_ARGS": str(self.root / "parse-args.txt"),
            "TEST_PARSE_STATUS": "0",
            "TEST_PARSE_STDERR": "",
            "TEST_PARSE_STDOUT": "",
        }
        self.env.pop("SUI_FRAMEWORK_ROOT", None)

    @staticmethod
    def executable(path, text):
        path.write_text(text)
        path.chmod(0o755)

    def run_script(self):
        return subprocess.run(
            ["bash", str(self.root / "run-tests.sh")],
            cwd=self.root,
            env=self.env,
            capture_output=True,
            text=True,
            timeout=15,
        )

    def test_quiet_success(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("OK: all 1 files parsed cleanly", result.stdout)

    def test_stderr_only_failure(self):
        self.env.update(TEST_PARSE_STATUS="1", TEST_PARSE_STDERR="compiler failed")
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("compiler failed", result.stderr)
        self.assertNotIn("OK:", result.stdout)

    def test_silent_failure(self):
        self.env["TEST_PARSE_STATUS"] = "2"
        self.assertNotEqual(self.run_script().returncode, 0)

    def test_stdout_errors_fail_even_with_success_status(self):
        self.env["TEST_PARSE_STDOUT"] = "example.move: ERROR"
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("example.move: ERROR", result.stdout)

    def test_rejects_different_patch_version(self):
        self.env["TEST_CLI_VERSION"] = VERSION + "-different"
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("expected tree-sitter-cli", result.stdout)

    def test_missing_explicit_framework_root_fails(self):
        self.env["SUI_FRAMEWORK_ROOT"] = str(self.root / "missing")
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("SUI_FRAMEWORK_ROOT is not a directory", result.stderr)

    def test_empty_framework_package_fails(self):
        self.env["SUI_FRAMEWORK_ROOT"] = str(self.root)
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no Move files found", result.stderr)

    def test_explicit_framework_root_and_spaces(self):
        framework = self.root / "framework with spaces"
        files = []
        for package in ("sui-framework", "move-stdlib"):
            source = framework / package / "sources" / "with spaces.move"
            source.parent.mkdir(parents=True)
            source.write_text("module a::b {}\n")
            files.append(str(source))
        self.env["SUI_FRAMEWORK_ROOT"] = str(framework)
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("OK: all 3 files parsed cleanly", result.stdout)
        self.assertEqual(
            (self.root / "parse-args.txt").read_text().splitlines(),
            ["parse", "-q", "tests/example.move", *files],
        )

    def test_empty_local_sweep_fails(self):
        (self.root / "tests" / "example.move").unlink()
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no local Move fixtures found", result.stderr)

    def test_additional_framework_packages_are_swept(self):
        framework = self.root / "packages"
        for package in ("sui-framework", "move-stdlib", "sui-system"):
            source = framework / package / "sources" / "example.move"
            source.parent.mkdir(parents=True)
            source.write_text("module a::b {}\n")
        self.env["SUI_FRAMEWORK_ROOT"] = str(framework)
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("OK: all 4 files parsed cleanly", result.stdout)
        self.assertIn(
            str(framework / "sui-system" / "sources" / "example.move"),
            (self.root / "parse-args.txt").read_text().splitlines(),
        )


if __name__ == "__main__":
    unittest.main()
