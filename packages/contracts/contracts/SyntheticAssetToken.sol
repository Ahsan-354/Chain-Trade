// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract SyntheticAssetToken is ERC20 {
    constructor(string memory name, string memory symbol, address exchange, uint256 liquidity)
        ERC20(name, symbol)
    {
        _mint(exchange, liquidity);
    }
}
