// Truffle requires a Migrations contract for its migration framework.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract Migrations {
    address public owner = msg.sender;
    uint256 public last_completed_migration;

    modifier restricted() {
        require(msg.sender == owner, "Restricted to contract owner");
        _;
    }

    function setCompleted(uint256 completed) public restricted {
        last_completed_migration = completed;
    }
}
