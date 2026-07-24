module test::constants {
    const MAX_SUPPLY: u64 = 1000;
    //    ^ constant
    const EInvalidArg: u64 = 1;
    //    ^ constant

    fun f(x: u64): u64 {
        assert!(x > 0, EInvalidArg);
        //             ^ constant
        if (x > MAX_SUPPLY) abort EInvalidArg;
        //      ^ constant
        //                        ^ constant
        MAX_SUPPLY
        // <- constant
    }
}
