/**
 * Truffle configuration for the EVM Blockchain project.
 *
 * ASSUMPTION: Ganache is running locally on http://127.0.0.1:7545
 * (the default Ganache GUI port). If you are using ganache-cli,
 * the default port is 8545 — update the port below accordingly.
 */

module.exports = {
  networks: {
    development: {
      host: "127.0.0.1",
      port: 7545,           // Ganache GUI EVM-Blockchain workspace port
      network_id: "*",      // Match any network id
    },
  },

  // Solidity compiler settings
  compilers: {
    solc: {
      version: "0.8.19",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        },
      },
    },
  },
};
