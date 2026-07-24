module test::vector_hl {
    fun f() {
        let a = vector[1, 2];
        //      ^ type.builtin
        let b = vector<u8>[1];
        //      ^ type.builtin
        let c = vector::empty<u64>();
        //      ^ namespace.module.name
        //              ^ function.call
    }
}
