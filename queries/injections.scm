; Generic comment injection (TODO/FIXME highlighting via the `comment` parser,
; when installed). Doc comments below override this with markdown.
([
  (line_comment)
  (block_comment)
] @injection.content
  (#set! injection.language "comment"))

; `///` doc comments expose their text (without the marker) as doc_comment
; nodes; combined, they form one markdown document, matching how the
; move-analyzer hover renders them.
((doc_comment) @injection.content
  (#set! injection.language "markdown")
  (#set! injection.combined))

; `/** ... */` block doc comments (no content node yet — backlog S3b)
((block_comment) @injection.content
  (#match? @injection.content "^/\\*\\*")
  (#set! injection.language "markdown"))
