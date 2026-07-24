module test::vector_literals {
    use std::vector;

    fun all_vector_forms() {
        let a = vector[1, 2];
        let b = vector[];
        let c = vector<u8>[1, 2];
        let d = vector [1, 2];
        let e = vector <u8> [1, 2];
        let f = vector[vector[1], vector[2]];
        let g = vector<vector<u8>>[vector[1]];
        // `vector` as a module name must keep working
        let h = vector::empty<u64>();
        let i = vector::singleton(1);
        vector::push_back(&mut i, 3);
        let j = std::vector::length(&i);
        let k = vector[1, 2].length();
    }
}
