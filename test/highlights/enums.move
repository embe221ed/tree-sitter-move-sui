module test::enums {
    public enum Color has drop { Red, Green }
    //          ^ type.definition.struct
    //                           ^ constructor

    fun f(c: Color): u64 {
        //   ^ type
        match (c) {
            Color::Red => 1,
            // <- type
            //     ^ constructor
            Color::Green => MAX,
        }
    }

    fun g(): Color {
        Color::Red
        // <- type
        //     ^ constructor
    }
}
