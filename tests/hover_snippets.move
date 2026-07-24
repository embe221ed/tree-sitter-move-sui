public fun sui::coin::split<T>(
  self: &mut sui::coin::Coin<T>,
  split_amount: u64,
  ctx: &mut sui::tx_context::TxContext
): sui::coin::Coin<T>
public struct sui::coin::Coin<phantom T> has key, store {
  id: sui::object::UID,
  balance: sui::balance::Balance<T>
}
public struct a::m::Pair {
  0: u64,
  1: bool
}
public enum std::option::Option<T> has copy, drop, store {
  None,
  Some( /* ... */ ),
  /* ... */
}
std::option::Option::Some(u64)
a::m::Shape::Circle{ radius: u64 }
std::option::Option::None
const sui::coin::EInvalidArg: u64 = 1
const a::m::NESTED: vector<vector<u64>> = [[1, 2], [3]]
let mut balance: sui::balance::Balance<T>
amount: u64
0: u64
module sui::coin
&mut sui::table::Table<address, sui::coin::Coin<T>>
