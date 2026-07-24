module test::comments {
    /// Documentation body
    //  ^ comment.documentation
    fun f() {}

    // plain comment
    //  ^ comment
    fun g() {
        if (true) { return } else { abort 0 };
        // <- keyword.conditional
        //                    ^ keyword.conditional
    }
}
