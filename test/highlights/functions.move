module test::functions {
    fun add(first: u64, other: &u64, target: &mut u64): u64 {
    //  ^ function
    //      ^ variable.parameter
    //                  ^ parameter.readonly
    //                               ^ parameter.modification
        coin::value(first);
        // <- namespace.module.name
        //    ^ function.call
        first + 1
        // <- variable
    }

    public struct S has key { id: UID, balance: u64 }
    //            ^ type.definition.struct
    //                        ^ property
    fun get(s: S): u64 { s.balance }
    //                     ^ property
}
