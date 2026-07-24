module test::datatype_edge_cases {
    // empty type parameter lists
    public struct C<>()
    public struct D<> {}
    public enum E<> { V }

    // `phantom` before a macro-style `$` type parameter
    public struct S<phantom $T>()

    fun uses(_c: C, _d: D): u8 {
        match (E::V) {
            E::V => 0,
        }
    }
}
