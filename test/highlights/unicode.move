module test::unicode {
    fun f() {
        let message = "pattern: 99";
        //            ^ string
        /* café café */ let x = 0;
        //                  ^ variable
        /* café café */ x;
        //              ^ variable
    }
}
/// final doc comment without a newline