address a {
    module m {
        fun f(): u64 { 42 }
    }

    module n;
}

address 0x42 {
    module legacy {
        struct S has copy { x: u64 }
    }
}
