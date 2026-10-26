"""Regression checks for assertion positions and CLI output decoding."""

from contextlib import redirect_stdout
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("highlight_check", ROOT / "test/highlights/check.py")
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class HighlightChecker(unittest.TestCase):
    def test_assertions_use_utf8_columns(self):
        text = "/* café */ let x = 0;\n//            ^ variable\n"
        self.assertEqual(list(check.assertions(text)), [(0, 15, "variable")])

    def test_unicode_line_separator_does_not_change_tree_sitter_row(self):
        text = "/*\u2028*/ x;\n//    ^ variable\n"
        self.assertEqual(list(check.assertions(text)), [(0, 8, "variable")])

    def test_assertion_must_point_to_source(self):
        for text in ["// ^ variable\n", "x;\n//          ^ variable\n"]:
            with self.subTest(text=text), self.assertRaises(ValueError):
                list(check.assertions(text))

    def test_source_text_cannot_change_pattern_number(self):
        output = '''  pattern: 45
    capture: 30 - string, start: (2, 12), end: (2, 25), text: `"pattern: 99"`
'''
        self.assertEqual(check.winning_captures(output)(2, 12), "string")

    def test_unicode_separator_in_capture_text_is_not_a_cli_line(self):
        output = (
            "  pattern: 50\n"
            "    capture: constant, start: (0, 0), end: (0, 20)\n"
            "  pattern: 45\n"
            "    capture: 30 - string, start: (0, 0), end: (0, 20), "
            "text: `\"\u2028pattern: 99\u2028\"`\n"
            "    capture: variable, start: (0, 0), end: (0, 20)\n"
        )
        self.assertEqual(check.winning_captures(output)(0, 0), "constant")

    def check_doc_span(self, source, end):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "doc.move"
            path.write_bytes(source)
            output = (
                "  pattern: 4\n"
                "    capture: comment.documentation, start: (0, 3), "
                f"end: ({end[0]}, {end[1]})\n"
            )
            with redirect_stdout(io.StringIO()):
                return check.doc_comment_spans_include_newline(path, output)

    def test_eof_doc_comment_does_not_require_newline(self):
        self.assertEqual(self.check_doc_span(b"/// text", (0, 8)), 0)

    def test_newline_doc_comment_requires_exact_end(self):
        self.assertEqual(self.check_doc_span(b"/// text\nnext", (1, 0)), 0)
        self.assertEqual(self.check_doc_span(b"/// text\nnext", (0, 8)), 1)
        self.assertEqual(self.check_doc_span(b"/// text\nnext", (1, 2)), 1)

    def test_crlf_doc_range_uses_original_bytes(self):
        self.assertEqual(self.check_doc_span(b"/// text\r\nnext", (1, 0)), 0)
        self.assertEqual(self.check_doc_span(b"/// text\r", (0, 9)), 0)

    def test_no_fixtures_is_a_failure(self):
        with patch.object(Path, "glob", return_value=iter(())):
            with self.assertRaisesRegex(SystemExit, "no highlight fixtures"):
                check.main()


if __name__ == "__main__":
    unittest.main()
