// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract ChainTradeExchange is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable cst;
    bytes32 public immutable deploymentId;
    mapping(address => uint256) public prices;
    mapping(address => mapping(bytes32 => bool)) public filled;
    uint256 public assetCount;

    error InvalidAsset();
    error InvalidPrice();
    error InvalidQuantity();
    error PriceChanged();
    error InsufficientBalance();
    error InsufficientLiquidity();
    error OrderAlreadyFilled();

    event PriceUpdated(address indexed asset, uint256 previousPrice, uint256 price);
    event TradeExecuted(
        address indexed trader, address indexed asset, bytes32 indexed orderId,
        bool isBuy, uint256 quantity, uint256 price, uint256 total
    );

    constructor(address token, bytes32 id) Ownable(msg.sender) {
        cst = IERC20(token);
        deploymentId = id;
    }

    function addAsset(address asset, uint256 price) external onlyOwner {
        if (asset.code.length == 0 || asset == address(cst) || prices[asset] != 0 || assetCount == 3) {
            revert InvalidAsset();
        }
        ++assetCount;
        _setPrice(asset, price);
    }

    function setPrices(address[] calldata assets, uint256[] calldata newPrices) external onlyOwner {
        if (assets.length == 0 || assets.length != newPrices.length) revert InvalidPrice();
        for (uint256 i = 0; i < assets.length; ++i) {
            if (prices[assets[i]] == 0) revert InvalidAsset();
            _setPrice(assets[i], newPrices[i]);
        }
    }

    function _setPrice(address asset, uint256 price) private {
        if (price == 0) revert InvalidPrice();
        emit PriceUpdated(asset, prices[asset], price);
        prices[asset] = price;
    }

    function pause() external onlyOwner { _pause(); }
    function resume() external onlyOwner { _unpause(); }

    function trade(address asset, bool isBuy, uint256 quantity, uint256 expectedPrice, bytes32 orderId)
        external whenNotPaused nonReentrant
    {
        uint256 price = prices[asset];
        if (price == 0) revert InvalidAsset();
        if (price != expectedPrice) revert PriceChanged();
        if (quantity == 0) revert InvalidQuantity();
        if (filled[msg.sender][orderId]) revert OrderAlreadyFilled();

        uint256 total = Math.mulDiv(quantity, price, 1 ether);
        if (total == 0) revert InvalidQuantity();
        IERC20 payToken = isBuy ? cst : IERC20(asset);
        IERC20 receiveToken = isBuy ? IERC20(asset) : cst;
        uint256 payAmount = isBuy ? total : quantity;
        uint256 receiveAmount = isBuy ? quantity : total;

        if (payToken.balanceOf(msg.sender) < payAmount) revert InsufficientBalance();
        if (receiveToken.balanceOf(address(this)) < receiveAmount) revert InsufficientLiquidity();

        filled[msg.sender][orderId] = true;
        payToken.safeTransferFrom(msg.sender, address(this), payAmount);
        receiveToken.safeTransfer(msg.sender, receiveAmount);
        emit TradeExecuted(msg.sender, asset, orderId, isBuy, quantity, price, total);
    }
}
