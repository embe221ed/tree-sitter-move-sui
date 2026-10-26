#!/usr/bin/env python3
"""Report native parse timings; optionally compare a saved baseline library.

Timings come from the parser, excluding process startup and compilation. This
is a manual benchmark, not a CI timing assertion: shared hosts are noisy.
"""

import argparse
import json
from pathlib import Path
import statistics
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "node_modules" / ".bin" / "tree-sitter"


def positive(value):
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be positive")
    return number


def measure(library, files):
    result = subprocess.run(
        [str(CLI), "parse", "--quiet", "--json-summary", "--lib-path", str(library),
         "--lang-name", "move", *map(str, files)],
        cwd=ROOT, text=True, capture_output=True, timeout=60,
    )
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    data = json.loads(result.stdout)
    stats = data["cumulative_stats"]
    if stats["successful_parses"] != len(files) or stats["total_parses"] != len(files):
        raise RuntimeError(f"Incomplete or unsuccessful benchmark parse: {stats}")
    duration = stats["total_duration"]
    return (duration["secs"] * 1_000_000_000 + duration["nanos"]) / 1_000_000


def main():
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("--baseline-library", type=Path)
    arguments.add_argument("--framework-root", type=Path)
    arguments.add_argument("--samples", type=positive, default=7)
    arguments.add_argument("--scale", type=positive, default=1000)
    arguments.add_argument("--json", action="store_true", help="print raw samples as JSON")
    options = arguments.parse_args()
    scale = options.scale
    fixtures = {
        "statements": "module t::m { fun f() {\n" + "let x = vector<u64>[1, 2, 3];\n" * scale + "} }",
        "generics": "module t::m { fun f() {\n" + "m::call<Option<vector<u64>>>(x);\n" * scale + "} }",
        "comparisons": "module t::m { fun f() {\n" + "h(a < b, c > (d));\n" * scale + "} }",
        "long_identifiers": "module t::m { fun f() {\n" + "let vector_like_identifier_with_a_long_name = other_identifier_with_a_long_name;\n" * scale + "} }",
        "doc_comments": "module t::m;\n" + "/// café 🦀 body\n" * (scale * 3) + "fun f() {}",
        "nested_comments": "module t::m { fun f() { vector " + "/*" * scale + "nested" + "*/" * scale + "[1]; } }",
    }
    with tempfile.TemporaryDirectory(prefix="move-parse-benchmark-") as temporary:
        directory = Path(temporary)
        current = directory / "current.so"
        subprocess.run([str(CLI), "build", "--output", str(current)], cwd=ROOT, check=True)
        libraries = {"current": current}
        if options.baseline_library:
            libraries["baseline"] = options.baseline_library.resolve(strict=True)
        groups = {}
        for name, source in fixtures.items():
            file = directory / f"{name}.move"
            file.write_text(source, encoding="utf-8")
            groups[name] = [file]
        if options.framework_root:
            files = sorted(options.framework_root.resolve(strict=True).rglob("*.move"))
            if not files:
                arguments.error("framework root contains no Move files")
            groups["framework"] = files

        samples = {name: {label: [] for label in libraries} for name in groups}
        # One discarded warmup; alternate order to reduce systematic cache bias.
        for iteration in range(options.samples + 1):
            order = list(libraries)
            if iteration % 2:
                order.reverse()
            for label in order:
                for name, files in groups.items():
                    elapsed = measure(libraries[label], files)
                    if iteration:
                        samples[name][label].append(elapsed)
        if options.json:
            print(json.dumps(samples, indent=2))
            return
        print("workload           current ms   baseline ms   change")
        for name, values in samples.items():
            current_ms = statistics.median(values["current"])
            if "baseline" in values:
                baseline_ms = statistics.median(values["baseline"])
                delta = (current_ms / baseline_ms - 1) * 100
                print(f"{name:18} {current_ms:10.3f} {baseline_ms:13.3f} {delta:+7.1f}%")
            else:
                print(f"{name:18} {current_ms:10.3f}")
        print("Median parse time; lower is faster. Compare ranges with --json before claiming a gain.")


if __name__ == "__main__":
    main()
