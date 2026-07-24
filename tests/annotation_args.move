module test::annotation_args {
    #[mode()]
    fun empty_annotation_args() {}

    #[mode(a)]
    #[mode(a, b)]
    fun multi_mode() {}
}
