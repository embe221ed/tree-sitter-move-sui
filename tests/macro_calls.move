module test::macro_calls {
    fun f(opt: Option<u64>, c: Coin<SUI>): u64 {
        constants::b9_scaling!();
        let x = constants::b9_scaling!() + 1;
        assert!(x > 0, 0);
        std::u64::max!(1, 2);
        min!<u64>(1, 2);
        pair!<A<B>, C<D>>(1, 2);
        opt.destroy_or!(abort 0);
        coin::value(&c)
    }
}
