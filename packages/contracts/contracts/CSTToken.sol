// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract CSTToken is ERC20, Ownable {
    uint256 public constant STARTER_REWARD = 10_000 ether;
    mapping(address => bool) public funded;

    error AlreadyFunded();
    event StarterReward(address indexed wallet, uint256 amount);

    constructor() ERC20("ChainTrade Token", "CST") Ownable(msg.sender) {}

    function mintLiquidity(address exchange, uint256 amount) external onlyOwner {
        _mint(exchange, amount);
    }

    function grantStarter(address wallet) external onlyOwner {
        if (funded[wallet]) revert AlreadyFunded();
        funded[wallet] = true;
        _mint(wallet, STARTER_REWARD);
        emit StarterReward(wallet, STARTER_REWARD);
    }
}
