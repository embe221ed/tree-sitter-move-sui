; Generic comment injection (TODO/FIXME highlighting via the `comment` parser,
; when installed). Doc comments below override this with markdown.
([
  (line_comment)
  (block_comment)
] @injection.content
  (#set! injection.language "comment"))

; Each contiguous `///` run is one line_comment node whose doc_comment
; children (marker-free, newline-inclusive) form one markdown document.
; Injecting per block — not with a file-wide injection.combined — keeps
; markdown sections (`# headings`) from spanning unrelated docstrings and
; the code between them.
(line_comment
  (doc_comment)+ @injection.content
  (#set! injection.language "markdown"))

; `/** ... */` block doc comments (no content node yet — backlog S3b)
((block_comment) @injection.content
  (#match? @injection.content "^/\\*\\*")
  (#set! injection.language "markdown"))
