// Items that the Move compiler's parser accepts even though later stages
// reject them; the grammar should not produce parse errors for these.
module test::parse_only_members {
    native macro fun foo();

    friend a::m;
    friend a::m::foo;
}
