module test::macros {
    fun f() {
        constants::b9_scaling!();
        // <- namespace.module.name
        //         ^ function.macro
        //                   ^ function.macro
        assert!(true, 0);
        // <- function.macro
        std::u64::max!(1, 2);
        //        ^ function.macro
    }

    macro fun twice($x: u64): u64 { $x + $x }
    //        ^ function.macro
}
