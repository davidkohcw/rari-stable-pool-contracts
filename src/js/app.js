// Unpackage imports
const Web3Modal = window.Web3Modal.default;
const WalletConnectProvider = window.WalletConnectProvider.default;
const EvmChains = window.EvmChains;
const Fortmatic = window.Fortmatic;
const Torus = window.Torus;
const Portis = window.Portis;
const Authereum = window.Authereum;

App = {
  web3: null,
  web3Modal: null,
  web3Provider: null,
  accounts: [],
  selectedAccount: null,
  contracts: {},
  tokens: {
    "DAI": { decimals: 18, address: "0x6B175474E89094C44Da98b954EedeAC495271d0F" },
    "USDC": { decimals: 6, address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
    "USDT": { decimals: 6, address: "0xdAC17F958D2ee523a2206206994597C13D831ec7" }
  },
  erc20Abi: null,
  compApyPrices: {},
  compApyPricesLastUpdated: 0,

  init: function() {
    if (location.hash === "#account") {
      $('#container-fund').hide();
      $('#container-account').show();
      $('#tab-fund').css('text-decoration', '');
      $('#tab-account').css('text-decoration', 'underline');
    }

    $('#tab-fund').click(function() {
      $('#container-account').hide();
      $('#container-fund').show();
      $('#tab-account').css('text-decoration', '');
      $('#tab-fund').css('text-decoration', 'underline');
    });

    $('#tab-account').click(function() {
      $('#container-fund').hide();
      $('#container-account').show();
      $('#tab-fund').css('text-decoration', '');
      $('#tab-account').css('text-decoration', 'underline');
    });

    App.initChartColors();
    App.initAprChart();
    App.initWeb3();
    App.bindEvents();
  },

  initChartColors: function() {
    window.chartColors = {
      red: 'rgb(255, 99, 132)',
      orange: 'rgb(255, 159, 64)',
      yellow: 'rgb(255, 205, 86)',
      green: 'rgb(75, 192, 192)',
      blue: 'rgb(54, 162, 235)',
      purple: 'rgb(153, 102, 255)',
      grey: 'rgb(201, 203, 207)'
    };
  },

  getCurrentApy: async function() {
    var factors = [];
    var totalBalanceUsdBN = Web3.utils.toBN(0);
    var dydxApyBNs = await App.getDydxApyBNs();
    var compoundApyBNs = await App.getCompoundApyBNs();

    for (const currencyCode of ["DAI", "USDC", "USDT"]) {
        var contractBalanceBN = Web3.utils.toBN(await App.tokens[currencyCode].contract.methods.balanceOf(App.contracts.RariFundController.options.address).call());
        var contractBalanceUsdBN = contractBalanceBN.mul(Web3.utils.toBN(currencyCode === "DAI" ? 1e18 : 1e6)); // TODO: Factor in prices; for now we assume the value of all supported currencies = $1
        factors.push([contractBalanceUsdBN, Web3.utils.toBN(0)]);
        totalBalanceUsdBN = totalBalanceUsdBN.add(contractBalanceUsdBN);

        var poolBalances = await App.contracts.RariFundController.methods.getPoolBalances(currencyCode).call();

        for (var i = 0; i < poolBalances["0"].length; i++) {
            var poolBalanceBN = Web3.utils.toBN(poolBalances["1"][i]);
            var poolBalanceUsdBN = poolBalanceBN.mul(Web3.utils.toBN(currencyCode === "DAI" ? 1e18 : 1e6)); // TODO: Factor in prices; for now we assume the value of all supported currencies = $1
            var apyBN = poolBalances["0"][i] == 1 ? compoundApyBNs[currencyCode][0].add(compoundApyBNs[currencyCode][1]) : dydxApyBNs[currencyCode];
            factors.push([poolBalanceUsdBN, apyBN]);
            totalBalanceUsdBN = totalBalanceUsdBN.add(poolBalanceUsdBN);
        }
    }

    if (totalBalanceUsdBN.isZero()) {
      var maxApyBN = 0;
      for (var i = 0; i < factors.length; i++) if (factors[i][1].gt(maxApyBN)) maxApyBN = factors[i][1];
      return $('#APYNow').text((parseFloat(maxApyBN.toString()) / 1e16).toFixed(2) + "%");
    }

    var apyBN = Web3.utils.toBN(0);
    for (var i = 0; i < factors.length; i++) apyBN.iadd(factors[i][0].mul(factors[i][1]).div(totalBalanceUsdBN));
    $('#APYNow').text((parseFloat(apyBN.toString()) / 1e16).toFixed(2) + "%");
  },

  getDydxApyBNs: async function() {
    const data = await $.getJSON("https://api.dydx.exchange/v1/markets");
    var apyBNs = {};

    for (var i = 0; i < data.markets.length; i++)
      if (["DAI", "USDC", "USDT"].indexOf(data.markets[i].symbol) >= 0)
        apyBNs[data.markets[i].symbol] = Web3.utils.toBN(Math.trunc(parseFloat(data.markets[i].totalSupplyAPR) * 1e18));

    return apyBNs;
  },

  getCompoundApyBNs: async function() {
    const data = await $.getJSON("https://api.compound.finance/api/v2/ctoken");
    var apyBNs = {};

    for (var i = 0; i < data.cToken.length; i++) {
      if (["DAI", "USDC", "USDT"].indexOf(data.cToken[i].underlying_symbol) >= 0) {
        var supplyApy = Web3.utils.toBN(Math.trunc(parseFloat(data.cToken[i].supply_rate.value) * 1e18));
        var compApy = Web3.utils.toBN(Math.trunc((await App.getApyFromComp(data.cToken[i].underlying_symbol, data.cToken)) * 1e18));
        apyBNs[data.cToken[i].underlying_symbol] = [supplyApy, compApy];
      }
    }

    return apyBNs;
  },

  get0xPrices: function(inputTokenSymbol, outputTokenSymbols) {
    return new Promise((resolve, reject) => {
      $.getJSON('https://api.0x.org/swap/v0/prices?sellToken=' + inputTokenSymbol, function(decoded) {
        if (!decoded) reject("Failed to decode prices from 0x swap API");
        if (!decoded.records) reject("No prices found on 0x swap API");
        var prices = {};
        for (var i = 0; i < decoded.records.length; i++)
          if (outputTokenSymbols.indexOf(decoded.records[i].symbol) >= 0) prices[decoded.records[i].symbol] = ["DAI", "USDC", "USDT", "SAI"].indexOf(decoded.records[i].symbol) >= 0 ? 1.0 : decoded.records[i].price;
        if (prices.length != outputTokenSymbols.length) return reject("One or more prices not found on 0x swap API");
        resolve(prices);
      }).fail(function(err) {
        reject("Error requesting prices from 0x swap API: " + err.message);
      });
    });
  },

  getApyFromComp: async function(currencyCode, cTokens) {
    // Get cToken USD prices
    var currencyCodes = ["COMP"];
    var priceMissing = false;

    for (const cToken of cTokens) {
      currencyCodes.push(cToken.underlying_symbol);
      if (!App.compApyPrices[cToken.underlying_symbol]) priceMissing = true;
    }

    var now = (new Date()).getTime() / 1000;

    if (now > App.compApyPricesLastUpdated + 900 || priceMissing) {
      App.compApyPrices = await App.get0xPrices("DAI", currencyCodes); // TODO: Get real USD prices, not DAI prices
      App.compApyPricesLastUpdated = now;
    }
    
    // Get currency APY and total yearly interest
    var currencyUnderlyingSupply = 0;
    var currencyBorrowUsd = 0;
    var totalBorrowUsd = 0;
    
    for (const cToken of cTokens) {
      var underlyingBorrow = cToken.total_borrows.value * cToken.exchange_rate.value;
      var borrowUsd = underlyingBorrow * App.compApyPrices[cToken.underlying_symbol];

      if (cToken.underlying_symbol === currencyCode) {
        currencyUnderlyingSupply = cToken.total_supply.value * cToken.exchange_rate.value;
        currencyBorrowUsd = borrowUsd;
      }

      totalBorrowUsd += borrowUsd;
    }
    
    // Get APY from COMP per block for this currency
    var compPerBlock = 0.5;
    var marketCompPerBlock = compPerBlock * (currencyBorrowUsd / totalBorrowUsd);
    var marketSupplierCompPerBlock = marketCompPerBlock / 2;
    var marketSupplierCompPerBlockPerUsd = marketSupplierCompPerBlock / currencyUnderlyingSupply; // Assumes that the value of currencyCode is $1
    var marketSupplierUsdFromCompPerBlockPerUsd = marketSupplierCompPerBlockPerUsd * App.compApyPrices["COMP"];
    return marketSupplierUsdFromCompPerBlockPerUsd * 2102400;
  },

  initAprChart: function() {
    Promise.all([
      $.getJSON("dydx-aprs.json"),
      $.getJSON("compound-aprs.json")
    ]).then(function(values) {
      var ourData = {};

      var dydxAvgs = [];
      var epochs = Object.keys(values[0]).sort();

      for (var i = 0; i < epochs.length; i++) {
        // Calculate average for dYdX graph and max for our graph
        var sum = 0;
        var max = 0;

        for (const currencyCode of Object.keys(values[0][epochs[i]])) {
          sum += values[0][epochs[i]][currencyCode];
          if (values[0][epochs[i]][currencyCode] > max) max = values[0][epochs[i]][currencyCode];
        }

        dydxAvgs.push({ t: new Date(parseInt(epochs[i])), y: sum / Object.keys(values[0][epochs[i]]).length * 100 });

        // Add data for Rari graph
        var flooredEpoch = Math.floor(epochs[i] / 86400 / 1000) * 86400 * 1000;
        ourData[flooredEpoch] = max;
      }

      var compoundAvgs = [];
      var epochs = Object.keys(values[1]).sort();

      for (var i = 0; i < epochs.length; i++) {
        // Calculate average for Compound graph and max with COMP for our graph
        var sum = 0;
        var maxWithComp = 0;

        for (const currencyCode of Object.keys(values[1][epochs[i]])) {
          sum += values[1][epochs[i]][currencyCode][0];
          var apyWithComp = values[1][epochs[i]][currencyCode][0] + values[1][epochs[i]][currencyCode][1];
          if (apyWithComp > maxWithComp) maxWithComp = apyWithComp;
        }

        var avg = sum / Object.keys(values[1][epochs[i]]).length;
        compoundAvgs.push({ t: new Date(parseInt(epochs[i])), y: avg * 100 });

        // Add data for Rari graph
        var flooredEpoch = Math.floor(epochs[i] / 86400 / 1000) * 86400 * 1000;
        if (ourData[flooredEpoch] === undefined || maxWithComp > ourData[flooredEpoch]) ourData[flooredEpoch] = maxWithComp;
      }

      // Turn Rari data into object for graph
      var ourAvgs = [];
      var epochs = Object.keys(ourData).sort();
      for (var i = 0; i < epochs.length; i++) ourAvgs.push({ t: new Date(parseInt(epochs[i])), y: ourData[epochs[i]] * 100 });

      // Display today's estimated APY
      // TODO: Display real APY
      $('#APYToday').text((ourData[epochs[epochs.length - 1]] * 100).toFixed(2) + "%");

      // Init chart
      var ctx = document.getElementById('chart-aprs').getContext('2d');
      ctx.canvas.width = 1000;
      ctx.canvas.height = 300;

      var color = Chart.helpers.color;
      var cfg = {
        data: {
          datasets: [{
            label: 'Rari',
            backgroundColor: color(window.chartColors.green).alpha(0.5).rgbString(),
            borderColor: window.chartColors.green,
            data: ourAvgs,
            type: 'line',
            pointRadius: 0,
            fill: false,
            lineTension: 0,
            borderWidth: 2
          }, {
            label: 'dYdX',
            backgroundColor: color(window.chartColors.blue).alpha(0.5).rgbString(),
            borderColor: window.chartColors.blue,
            data: dydxAvgs,
            type: 'line',
            pointRadius: 0,
            fill: false,
            lineTension: 0,
            borderWidth: 2
          }, {
            label: 'Compound',
            backgroundColor: color(window.chartColors.red).alpha(0.5).rgbString(),
            borderColor: window.chartColors.red,
            data: compoundAvgs,
            type: 'line',
            pointRadius: 0,
            fill: false,
            lineTension: 0,
            borderWidth: 2
          }]
        },
        options: {
          animation: {
            duration: 0
          },
          scales: {
            xAxes: [{
              type: 'time',
              time: {
                unit: 'day',
                tooltipFormat: 'LL'
              },
              distribution: 'series',
              offset: true,
              ticks: {
                autoSkip: true,
                autoSkipPadding: 20,
                maxRotation: 0
              }
            }],
            yAxes: [{
              gridLines: {
                drawBorder: false
              },
              scaleLabel: {
                display: true,
                labelString: 'APY (%)'
              }
            }]
          },
          tooltips: {
            intersect: false,
            mode: 'index',
            callbacks: {
              label: function(tooltipItem, myData) {
                var label = myData.datasets[tooltipItem.datasetIndex].label || '';
                if (label) {
                  label += ': ';
                }
                label += parseFloat(tooltipItem.value).toFixed(2) + "%";
                return label;
              }
            }
          }
        }
      };

      var chart = new Chart(ctx, cfg);

      // Convert APR chart data into return chart data
      var dydxReturns = [];
      var currentReturn = 10000;
      for (var i = 0; i < dydxAvgs.length; i++) dydxReturns.push({ t: dydxAvgs[i].t, y: currentReturn *= (1 + (dydxAvgs[i].y / 100) / 365) });
      var compoundReturns = [];
      currentReturn = 10000;
      for (var i = 0; i < compoundAvgs.length; i++) compoundReturns.push({ t: compoundAvgs[i].t, y: currentReturn *= (1 + (compoundAvgs[i].y / 100) / 365) });
      var ourReturns = [];
      currentReturn = 10000;
      for (var i = 0; i < ourAvgs.length; i++) ourReturns.push({ t: ourAvgs[i].t, y: currentReturn *= (1 + (ourAvgs[i].y / 100) / 365) });

      // Init chart
      var ctx = document.getElementById('chart-return').getContext('2d');
      ctx.canvas.width = 1000;
      ctx.canvas.height = 300;

      var color = Chart.helpers.color;
      var cfg = {
        data: {
          datasets: [{
            label: 'Rari',
            backgroundColor: color(window.chartColors.green).alpha(0.5).rgbString(),
            borderColor: window.chartColors.green,
            data: ourReturns,
            type: 'line',
            pointRadius: 0,
            fill: false,
            lineTension: 0,
            borderWidth: 2
          }, {
            label: 'dYdX',
            backgroundColor: color(window.chartColors.blue).alpha(0.5).rgbString(),
            borderColor: window.chartColors.blue,
            data: dydxReturns,
            type: 'line',
            pointRadius: 0,
            fill: false,
            lineTension: 0,
            borderWidth: 2
          }, {
            label: 'Compound',
            backgroundColor: color(window.chartColors.red).alpha(0.5).rgbString(),
            borderColor: window.chartColors.red,
            data: compoundReturns,
            type: 'line',
            pointRadius: 0,
            fill: false,
            lineTension: 0,
            borderWidth: 2
          }]
        },
        options: {
          animation: {
            duration: 0
          },
          scales: {
            xAxes: [{
              type: 'time',
              time: {
                unit: 'day',
                tooltipFormat: 'LL'
              },
              distribution: 'series',
              offset: true,
              ticks: {
                autoSkip: true,
                autoSkipPadding: 20,
                maxRotation: 0
              }
            }],
            yAxes: [{
              gridLines: {
                drawBorder: false
              },
              scaleLabel: {
                display: true,
                labelString: 'Balance (USD)'
              }
            }]
          },
          tooltips: {
            intersect: false,
            mode: 'index',
            callbacks: {
              label: function(tooltipItem, myData) {
                var label = myData.datasets[tooltipItem.datasetIndex].label || '';
                if (label) {
                  label += ': ';
                }
                label += "$" + parseFloat(tooltipItem.value).toFixed(2);
                return label;
              }
            }
          }
        }
      };

      var chart = new Chart(ctx, cfg);
    });
  },

  /**
   * Initialize Web3Modal.
   */
  initWeb3Modal: function() {
    const providerOptions = {
      walletconnect: {
        package: WalletConnectProvider,
        options: {
          infuraId: "c52a3970da0a47978bee0fe7988b67b6"
        }
      },
  
      fortmatic: {
        package: Fortmatic,
        options: {
          key: "pk_live_A5F3924825DC427D"
        }
      },

      torus: {
        package: Torus,
        options: {}
      },

      portis: {
        package: Portis,
        options: {
          id: "1fd446cc-629b-46bc-a50c-6b7fe9251f05"
        }
      },

      authereum: {
        package: Authereum,
        options: {}
      }
    };
  
    App.web3Modal = new Web3Modal({
      cacheProvider: false, // optional
      providerOptions, // required
    });
  },

  /**
   * Kick in the UI action after Web3modal dialog has chosen a provider
   */
  fetchAccountData: async function() {
    // Get a Web3 instance for the wallet
    App.web3 = new Web3(App.web3Provider);
  
    // Get connected chain ID from Ethereum node
    const chainId = await App.web3.eth.getChainId();

    /* if (chainId !== 1) {
      $('#depositButton, #withdrawButton, #transferButton').prop("disabled", true);
      toastr["error"]("Invalid chain selected.", "Ethereum connection failed");
    } */
  
    // Get list of accounts of the connected wallet
    // MetaMask does not give you all accounts, only the selected account
    App.accounts = await App.web3.eth.getAccounts();
    App.selectedAccount = App.accounts[0];

    // Refresh contracts to use new Web3
    for (const symbol of Object.keys(App.contracts)) App.contracts[symbol] = new App.web3.eth.Contract(App.contracts[symbol].options.jsonInterface, App.contracts[symbol].options.address);
    for (const symbol of Object.keys(App.tokens)) if (App.tokens[symbol].contract) App.tokens[symbol].contract = new App.web3.eth.Contract(App.tokens[symbol].contract.options.jsonInterface, App.tokens[symbol].address);

    // Get user's account balance in the quant fund and RFT balance
    if (App.contracts.RariFundManager) {
      App.getMyFundBalance();
      if (!App.intervalGetMyFundBalance) App.intervalGetMyFundBalance = setInterval(App.getMyFundBalance, 5 * 60 * 1000);
      App.getMyInterestAccrued();
      if (!App.intervalGetMyInterestAccrued) App.intervalGetMyInterestAccrued = setInterval(App.getMyInterestAccrued, 5 * 60 * 1000);
    }
    if (App.contracts.RariFundToken) {
      App.getTokenBalance();
      if (!App.intervalGetTokenBalance) App.intervalGetTokenBalance = setInterval(App.getTokenBalance, 5 * 60 * 1000);
    }
  
    // Load acounts dropdown
    $('#selected-account').empty();
    for (var i = 0; i < App.accounts.length; i++) $('#selected-account').append('<option' + (i == 0 ? ' selected' : '') + '>' + App.accounts[i] + '</option>');
  
    // Display fully loaded UI for wallet data
    $('#depositButton, #withdrawButton, #transferButton').prop("disabled", false);
  },
  
  /**
   * Fetch account data for UI when
   * - User switches accounts in wallet
   * - User switches networks in wallet
   * - User connects wallet initially
   */
  refreshAccountData: async function() {
    // If any current data is displayed when
    // the user is switching acounts in the wallet
    // immediate hide this data
    $("#MyDAIBalance, #MyUSDCBalance, #MyUSDTBalance, #RFTBalance").text("?");
  
    // Disable button while UI is loading.
    // fetchAccountData() will take a while as it communicates
    // with Ethereum node via JSON-RPC and loads chain data
    // over an API call.
    $(".btn-connect").text("Loading...");
    $(".btn-connect").prop("disabled", true);
    await App.fetchAccountData();
    $(".btn-connect").hide();
    $(".btn-connect").text("Connect");
    $(".btn-connect").prop("disabled", false);
    $("#btn-disconnect").show();
    $("#selected-account").show();
    $('#container-fund').hide();
    $('#container-account').show();
    $('#tab-fund').css('text-decoration', '');
    $('#tab-account').css('text-decoration', 'underline');
  },
  
  /**
   * Connect wallet button pressed.
   */
  connectWallet: async function() {
    // Setting this null forces to show the dialogue every time
    // regardless if we play around with a cacheProvider settings
    // in our localhost.
    // TODO: A clean API needed here
    App.web3Modal.providerController.cachedProvider = null;
  
    try {
      App.web3Provider = await App.web3Modal.connect();
    } catch(e) {
      console.error("Could not get a wallet connection", e);
      return;
    }
  
    // Subscribe to accounts change
    App.web3Provider.on("accountsChanged", (accounts) => {
      App.fetchAccountData();
    });
  
    // Subscribe to chainId change
    App.web3Provider.on("chainChanged", (chainId) => {
      App.fetchAccountData();
    });
  
    // Subscribe to networkId change
    App.web3Provider.on("networkChanged", (networkId) => {
      App.fetchAccountData();
    });
  
    await App.refreshAccountData();
  },
  
  /**
   * Disconnect wallet button pressed.
   */
  disconnectWallet: async function() {
    console.log("Killing the wallet connection", App.web3Provider);
  
    // TODO: MetamaskInpageProvider does not provide disconnect?
    if (App.web3Provider.close) {
      await App.web3Provider.close();
      App.web3Provider = null;
    }
  
    App.selectedAccount = null;
  
    // Set the UI back to the initial state
    $("#selected-account").empty();
    $("#selected-account").hide();
    $("#btn-disconnect").hide();
    $(".btn-connect").show();
    $('#MyUSDBalance').text("?");
    $('#RFTBalance').text("?");
    $('#MyInterestAccrued').text("?");
  },
  
  /**
   * Initialize the latest version of web3.js (MetaMask uses an oudated one that overwrites ours if we include it as an HTML tag), then initialize and connect Web3Modal.
   */
  initWeb3: function() {
    $.getScript("js/web3.min.js", function() {
      if (typeof web3 !== 'undefined') {
        App.web3 = new Web3(web3.currentProvider);
      } else {
        App.web3 = new Web3(new Web3.providers.HttpProvider("https://mainnet.infura.io/v3/c52a3970da0a47978bee0fe7988b67b6"));
      }
  
      App.initContracts();
      App.initWeb3Modal();
    });
  },
  
  /**
   * Initialize FundManager and FundToken contracts.
   */
  initContracts: function() {
    $.getJSON('abi/RariFundController.json', function(data) {
      App.contracts.RariFundController = new App.web3.eth.Contract(data, "0x15c4ae284fbb3a6ceb41fa8eb5f3408ac485fabb");
      /* App.getCurrentApy();
      setInterval(App.getCurrentApy, 5 * 60 * 1000); */
    });

    $.getJSON('abi/RariFundManager.json', function(data) {
      App.contracts.RariFundManager = new App.web3.eth.Contract(data, "0x6bdaf490c5b6bb58564b3e79c8d18e8dfd270464");
      App.getFundBalance();
      setInterval(App.getFundBalance, 5 * 60 * 1000);
      if (App.selectedAccount) {
        App.getMyFundBalance();
        if (!App.intervalGetMyFundBalance) App.intervalGetMyFundBalance = setInterval(App.getMyFundBalance, 5 * 60 * 1000);
        App.getMyInterestAccrued();
        if (!App.intervalGetMyInterestAccrued) App.intervalGetMyInterestAccrued = setInterval(App.getMyInterestAccrued, 5 * 60 * 1000);
      }
      App.getDirectlyDepositableCurrencies();
      App.getDirectlyWithdrawableCurrencies();
      setInterval(function() {
        App.getDirectlyDepositableCurrencies();
        App.getDirectlyWithdrawableCurrencies();
      }, 5 * 60 * 1000);
    });

    $.getJSON('abi/RariFundToken.json', function(data) {
      App.contracts.RariFundToken = new App.web3.eth.Contract(data, "0x9366B7C00894c3555c7590b0384e5F6a9D55659f");
      if (App.selectedAccount) {
        App.getTokenBalance();
        if (!App.intervalGetTokenBalance) App.intervalGetTokenBalance = setInterval(App.getTokenBalance, 5 * 60 * 1000);
      }
    });

    $.getJSON('abi/RariFundProxy.json', function(data) {
      App.contracts.RariFundProxy = new App.web3.eth.Contract(data, "0x318cfd99b60a63d265d2291a4ab982073fbf245d");
    });

    $.getJSON('abi/ERC20.json', function(data) {
      App.erc20Abi = data;
      for (const symbol of Object.keys(App.tokens)) App.tokens[symbol].contract = new App.web3.eth.Contract(data, App.tokens[symbol].address);
    });

    $.getJSON('https://api.0x.org/swap/v0/tokens', function(data) {
      data.records.sort((a, b) => a.symbol > b.symbol ? 1 : -1);
      for (const token of data.records) {
        if (App.tokens[token.symbol]) continue;
        App.tokens[token.symbol] = { address: token.address, decimals: token.decimals, contract: App.erc20Abi ? new App.web3.eth.Contract(App.erc20Abi, token.address) : null };
        $('#DepositToken').append('<option>' + token.symbol + '</option>');
        $('#WithdrawToken').append('<option>' + token.symbol + '</option>');
      }
    });
  },

  getDirectlyDepositableCurrencies: function() {
    for (const currencyCode of ["DAI", "USDC", "USDT"]) App.contracts.RariFundManager.methods.isCurrencyAccepted(currencyCode).call().then(function(accepted) {
      $('#DepositToken > option[value="' + currencyCode + '"]').text(currencyCode + (accepted ? " (no slippage)" : ""));
    });
  },

  getDirectlyWithdrawableCurrencies: function() {
    for (const currencyCode of ["DAI", "USDC", "USDT"]) App.contracts.RariFundManager.methods["getRawFundBalance(string)"](currencyCode).call().then(function (rawFundBalance) {
      $('#WithdrawToken > option[value="' + currencyCode + '"]').text(currencyCode + (parseFloat(rawFundBalance) > 0 ? " (no slippage up to " + (parseFloat(rawFundBalance) / (currencyCode === "DAI" ? 1e18 : 1e6)).toPrecision(4) + ")" : ""));
    });
  },
  
  /**
   * Bind button click events.
   */
  bindEvents: function() {
    $(document).on('click', '.btn-connect', App.connectWallet);
    $(document).on('click', '#btn-disconnect', App.disconnectWallet);

    $(document).on('change', '#selected-account', function() {
      // Set selected account
      App.selectedAccount = $(this).val();

      // Get user's account balance in the quant fund and RFT balance
      if (App.contracts.RariFundManager) {
        App.getMyFundBalance();
        if (!App.intervalGetMyFundBalance) App.intervalGetMyFundBalance = setInterval(App.getMyFundBalance, 5 * 60 * 1000);
        App.getMyInterestAccrued();
        if (!App.intervalGetMyInterestAccrued) App.intervalGetMyInterestAccrued = setInterval(App.getMyInterestAccrued, 5 * 60 * 1000);
      }
      if (App.contracts.RariFundToken) {
        App.getTokenBalance();
        if (!App.intervalGetTokenBalance) App.intervalGetTokenBalance = setInterval(App.getTokenBalance, 5 * 60 * 1000);
      }
    });

    $(document).on('change', '#DepositAmount', function() {
      $('#DepositSlippage').hide();
    });
    $(document).on('click', '#depositButton', App.handleDeposit);
    $(document).on('change', '#WithdrawAmount', function() {
      $('#WithdrawSlippage').hide();
    });
    $(document).on('click', '#withdrawButton', App.handleWithdraw);
    $(document).on('click', '#transferButton', App.handleTransfer);
  },

  get0xPrice: function(inputTokenSymbol, outputTokenSymbol) {
    return new Promise((resolve, reject) => {
      $.getJSON('https://api.0x.org/swap/v0/prices?sellToken=' + inputTokenSymbol, function(decoded) {
        if (!decoded) return reject("Failed to decode prices from 0x swap API");
        if (!decoded.records) return reject("No prices found on 0x swap API");
        for (var i = 0; i < decoded.records.length; i++)
          if (decoded.records[i].symbol === outputTokenSymbol)
            resolve(decoded.records[i].price);
        reject("Price not found on 0x swap API");
      }).fail(function(err) {
        reject("Error requesting prices from 0x swap API: " + err.message);
      });
    });
  },

  get0xSwapOrders: function(inputTokenAddress, outputTokenAddress, maxInputAmountBN, maxMakerAssetFillAmountBN) {
    return new Promise((resolve, reject) => {
      $.getJSON('https://api.0x.org/swap/v0/quote?sellToken=' + inputTokenAddress + '&buyToken=' + outputTokenAddress + (maxMakerAssetFillAmountBN !== undefined ? '&buyAmount=' + maxMakerAssetFillAmountBN.toString() : '&sellAmount=' + maxInputAmountBN.toString()), function(decoded) {
        if (!decoded) return reject("Failed to decode quote from 0x swap API");
        if (!decoded.orders) return reject("No orders found on 0x swap API");

        decoded.orders.sort((a, b) => a.makerAssetAmount / (a.takerAssetAmount + a.takerFee) < b.makerAssetAmount / (b.takerAssetAmount + b.takerFee) ? 1 : -1);

        var orders = [];
        var inputFilledAmountBN = Web3.utils.toBN(0);
        var takerAssetFilledAmountBN = Web3.utils.toBN(0);
        var makerAssetFilledAmountBN = Web3.utils.toBN(0);

        for (var i = 0; i < decoded.orders.length; i++) {
          if (decoded.orders[i].takerFee > 0 && decoded.orders[i].takerFeeAssetData.toLowerCase() !== "0xf47261b0000000000000000000000000" + inputTokenAddress.toLowerCase()) continue;
          var takerAssetAmountBN = Web3.utils.toBN(decoded.orders[i].takerAssetAmount);
          var takerFeeBN = Web3.utils.toBN(decoded.orders[i].takerFee);
          var orderInputAmountBN = takerAssetAmountBN.add(takerFeeBN); // Maximum amount we can send to this order including the taker fee
          var makerAssetAmountBN = Web3.utils.toBN(decoded.orders[i].makerAssetAmount);

          if (maxMakerAssetFillAmountBN !== undefined) {
            // maxMakerAssetFillAmountBN is specified, so use it
            if (maxMakerAssetFillAmountBN.sub(makerAssetFilledAmountBN).lte(makerAssetAmountBN)) {
              // Calculate orderTakerAssetFillAmountBN and orderInputFillAmountBN from maxMakerAssetFillAmountBN
              var orderMakerAssetFillAmountBN = maxMakerAssetFillAmountBN.sub(makerAssetFilledAmountBN);
              var orderTakerAssetFillAmountBN = orderMakerAssetFillAmountBN.mul(takerAssetAmountBN).div(makerAssetAmountBN);
              var orderInputFillAmountBN = orderMakerAssetFillAmountBN.mul(orderInputAmountBN).div(makerAssetAmountBN);
              
              console.log(orderMakerAssetFillAmountBN.toString(), orderInputFillAmountBN.toString(), makerAssetAmountBN.mul(orderInputFillAmountBN).div(orderInputAmountBN).toString());
              var tries = 0;
              while (makerAssetAmountBN.mul(orderInputFillAmountBN).div(orderInputAmountBN).lt(orderMakerAssetFillAmountBN)) {
                if (tries >= 1000) return toastr["error"]("Failed to get increment order input amount to achieve desired output amount: " + err, "Internal error");
                orderInputFillAmountBN.iadd(Web3.utils.toBN(1)); // Make sure we have enough input fill amount to achieve this maker asset fill amount
                tries++;
              }
              console.log(orderMakerAssetFillAmountBN.toString(), orderInputFillAmountBN.toString(), makerAssetAmountBN.mul(orderInputFillAmountBN).div(orderInputAmountBN).toString());
            } else {
              // Fill whole order
              var orderMakerAssetFillAmountBN = makerAssetAmountBN;
              var orderTakerAssetFillAmountBN = takerAssetAmountBN;
              var orderInputFillAmountBN = orderInputAmountBN;
            }

            // If this order input amount is higher than the remaining input, calculate orderTakerAssetFillAmountBN and orderMakerAssetFillAmountBN from the remaining maxInputAmountBN as usual
            if (orderInputFillAmountBN.gt(maxInputAmountBN.sub(inputFilledAmountBN))) {
              orderInputFillAmountBN = maxInputAmountBN.sub(inputFilledAmountBN);
              orderTakerAssetFillAmountBN = orderInputFillAmountBN.mul(takerAssetAmountBN).div(orderInputAmountBN);
              orderMakerAssetFillAmountBN = orderInputFillAmountBN.mul(makerAssetAmountBN).div(orderInputAmountBN);
            }
          } else {
            // maxMakerAssetFillAmountBN is not specified, so use maxInputAmountBN
            if (maxInputAmountBN.sub(inputFilledAmountBN).lte(orderInputAmountBN)) {
              // Calculate orderInputFillAmountBN and orderTakerAssetFillAmountBN from the remaining maxInputAmountBN as usual
              var orderInputFillAmountBN = maxInputAmountBN.sub(inputFilledAmountBN);
              var orderTakerAssetFillAmountBN = orderInputFillAmountBN.mul(takerAssetAmountBN).div(orderInputAmountBN);
              var orderMakerAssetFillAmountBN = orderInputFillAmountBN.mul(makerAssetAmountBN).div(orderInputAmountBN);
            } else {
              // Fill whole order
              var orderInputFillAmountBN = orderInputAmountBN;
              var orderTakerAssetFillAmountBN = takerAssetAmountBN;
              var orderMakerAssetFillAmountBN = makerAssetAmountBN;
            }
          }

          // Add order to returned array
          orders.push(decoded.orders[i]);

          // Add order fill amounts to total fill amounts
          inputFilledAmountBN.iadd(orderInputFillAmountBN);
          takerAssetFilledAmountBN.iadd(orderTakerAssetFillAmountBN);
          makerAssetFilledAmountBN.iadd(orderMakerAssetFillAmountBN);
          
          // Check if we have hit maxInputAmountBN or maxTakerAssetFillAmountBN
          if (inputFilledAmountBN.gte(maxInputAmountBN) || (maxMakerAssetFillAmountBN !== undefined && makerAssetFilledAmountBN.gte(maxMakerAssetFillAmountBN))) break;
        }

        if (takerAssetFilledAmountBN.isZero()) return reject("No orders found on 0x swap API");
        resolve([orders, inputFilledAmountBN, decoded.protocolFee, takerAssetFilledAmountBN, makerAssetFilledAmountBN, decoded.gasPrice]);
      }).fail(function(err) {
          reject("Error requesting quote from 0x swap API: " + err.message);
      });
    });
  },
  
  /**
   * Deposit funds to the quant fund.
   */
  handleDeposit: async function(event) {
    event.preventDefault();

    var token = $('#DepositToken').val();
    if (token !== "ETH" && !App.tokens[token]) return toastr["error"]("Invalid token!", "Deposit failed");
    var amount = parseFloat($('#DepositAmount').val());
    if (amount <= 0) return toastr["error"]("Amount must be greater than 0!", "Deposit failed");
    var amountBN = Web3.utils.toBN((new Big(amount)).mul((new Big(10)).pow(token == "ETH" ? 18 : App.tokens[token].decimals)).toFixed());
    var accountBalanceBN = Web3.utils.toBN(await (token == "ETH" ? App.web3.eth.getBalance(App.selectedAccount) : App.tokens[token].contract.methods.balanceOf(App.selectedAccount).call()));
    if (amountBN.gt(accountBalanceBN)) return toastr["error"]("Not enough balance in your account to make a deposit of this amount. Current account balance: " + (new Big(accountBalanceBN.toString())).div((new Big(10)).pow(token == "ETH" ? 18 : App.tokens[token].decimals)).toString() + " " + token, "Deposit failed");

    $('#depositButton').prop("disabled", true);
    $('#depositButton').text("...");

    await (async function() {
      App.getDirectlyDepositableCurrencies();

      var accepted = ["DAI", "USDC", "USDT"].indexOf(token) >= 0 ? await App.contracts.RariFundManager.methods.isCurrencyAccepted(token).call() : false;

      if (accepted) {
        $('#DepositSlippage').hide();

        console.log('Deposit ' + amount + ' ' + token + ' directly');

        // Approve tokens to RariFundManager
        try {
          var allowanceBN = Web3.utils.toBN(await App.tokens[token].contract.methods.allowance(App.selectedAccount, App.contracts.RariFundManager.options.address).call());
          if (allowanceBN.lt(amountBN)) await App.tokens[token].contract.methods.approve(App.contracts.RariFundManager.options.address, amountBN).send({ from: App.selectedAccount });
        } catch (err) {
          return toastr["error"]("Failed to approve tokens to RariFundManager: " + err, "Deposit failed");
        }
        
        // Deposit tokens to RariFundManager
        try {
          await App.contracts.RariFundManager.methods.deposit(token, amountBN).send({ from: App.selectedAccount });
        } catch (err) {
          return toastr["error"](err.message ? err.message : err, "Deposit failed");
        }
      } else {
        // Get accepted currency
        var acceptedCurrency = null;
        if (token !== "DAI" && await App.contracts.RariFundManager.methods.isCurrencyAccepted("DAI").call()) acceptedCurrency = "DAI";
        else if (token !== "USDC" && await App.contracts.RariFundManager.methods.isCurrencyAccepted("USDC").call()) acceptedCurrency = "USDC";
        else if (token !== "USDT" && await App.contracts.RariFundManager.methods.isCurrencyAccepted("USDT").call()) acceptedCurrency = "USDT";
        if (acceptedCurrency === null) return toastr["error"]("No accepted currencies found.", "Deposit failed");

        // Get orders from 0x swap API
        try {
          var [orders, inputFilledAmountBN, protocolFee, takerAssetFilledAmountBN, makerAssetFilledAmountBN, gasPrice] = await App.get0xSwapOrders(token === "ETH" ? "WETH" : App.tokens[token].address, App.tokens[acceptedCurrency].address, amountBN);
        } catch (err) {
          return toastr["error"]("Failed to get swap orders from 0x API: " + err, "Deposit failed");
        }
        
        // Make sure input amount is completely filled
        if (inputFilledAmountBN.lt(amountBN)) {
          $('#DepositAmount').val(inputFilledAmountBN.toString() / (10 ** (token == "ETH" ? 18 : App.tokens[token].decimals)));
          return toastr["warning"]("Unable to find enough liquidity to exchange " + token + " before depositing.", "Deposit canceled");
        }

        // Warn user of slippage
        var amountInputtedUsd = amount / (await App.get0xPrice(token === "ETH" ? "WETH" : token, acceptedCurrency));
        var amountOutputtedUsd = makerAssetFilledAmountBN.toString() / (10 ** App.tokens[acceptedCurrency].decimals);
        var slippage = 1 - (amountOutputtedUsd / amountInputtedUsd);
        var slippageAbsPercentageString = Math.abs(slippage * 100).toFixed(3);

        if (!$('#DepositSlippage').is(':visible')) {
          $('#DepositSlippage').html(slippage >= 0 ? 'Slippage: <kbd class="text-' + (slippageAbsPercentageString === "0.000" ? "info" : "danger") + '">' + slippageAbsPercentageString + '%</kbd>' : 'Bonus: <kbd class="text-success">' + slippageAbsPercentageString + '%</kbd>').show();
          return toastr["warning"]("Please note the exchange slippage required to make a deposit of this currency.", "Please try again");
        }

        if ($('#DepositSlippage kbd').text() !== slippageAbsPercentageString + "%") {
          $('#DepositSlippage').html(slippage >= 0 ? 'Slippage: <kbd class="text-' + (slippageAbsPercentageString === "0.000" ? "info" : "danger") + '">' + slippageAbsPercentageString + '%</kbd>' : 'Bonus: <kbd class="text-success">' + slippageAbsPercentageString + '%</kbd>').show();
          return toastr["warning"]("Exchange slippage changed.", "Please try again");
        }

        console.log('Exchange ' + amount + ' ' + token + ' to deposit ' + acceptedCurrency);

        // Approve tokens to RariFundProxy if token is not ETH
        if (token !== "ETH") {
          var allowanceBN = Web3.utils.toBN(await App.tokens[token].contract.methods.allowance(App.selectedAccount, App.contracts.RariFundProxy.options.address).call());
          if (allowanceBN.lt(amountBN)) await App.tokens[token].contract.methods.approve(App.contracts.RariFundProxy.options.address, amountBN).send({ from: App.selectedAccount });
        }

        // Build array of orders and signatures
        var signatures = [];

        for (var j = 0; j < orders.length; j++) {
          signatures[j] = orders[j].signature;
          
          orders[j] = {
            makerAddress: orders[j].makerAddress,
            takerAddress: orders[j].takerAddress,
            feeRecipientAddress: orders[j].feeRecipientAddress,
            senderAddress: orders[j].senderAddress,
            makerAssetAmount: orders[j].makerAssetAmount,
            takerAssetAmount: orders[j].takerAssetAmount,
            makerFee: orders[j].makerFee,
            takerFee: orders[j].takerFee,
            expirationTimeSeconds: orders[j].expirationTimeSeconds,
            salt: orders[j].salt,
            makerAssetData: orders[j].makerAssetData,
            takerAssetData: orders[j].takerAssetData,
            makerFeeAssetData: orders[j].makerFeeAssetData,
            takerFeeAssetData: orders[j].takerFeeAssetData
          };
        }

        // Exchange and deposit tokens via RariFundProxy
        try {
          await App.contracts.RariFundProxy.methods.exchangeAndDeposit(token === "ETH" ? "0x0000000000000000000000000000000000000000" : App.tokens[token].address, amountBN, acceptedCurrency, orders, signatures, takerAssetFilledAmountBN).send({ from: App.selectedAccount, value: token === "ETH" ? Web3.utils.toBN(protocolFee).add(amountBN).toString() : protocolFee, gasPrice: gasPrice });
        } catch (err) {
          return toastr["error"]("RariFundProxy.exchangeAndDeposit failed: " + err, "Deposit failed");
        }

        // Hide old slippage after exchange success
        $('#DepositSlippage').hide();
      }

      // Alert success and refresh balances
      toastr["success"]("Deposit of " + amount + " " + token + " confirmed!", "Deposit successful");
      $('#USDBalance').text("?");
      App.getFundBalance();
      $('#MyUSDBalance').text("?");
      App.getMyFundBalance();
      $('#RFTBalance').text("?");
      App.getTokenBalance();
      App.getDirectlyWithdrawableCurrencies();
    })();

    $('#depositButton').text("Deposit");
    $('#depositButton').prop("disabled", false);
  },
  
  /**
   * Withdraw funds from the quant fund.
   */
  handleWithdraw: async function(event) {
    event.preventDefault();

    var token = $('#WithdrawToken').val();
    if (token !== "ETH" && !App.tokens[token]) return toastr["error"]("Invalid token!", "Withdrawal failed");
    var amount = parseFloat($('#WithdrawAmount').val());
    if (amount <= 0) return toastr["error"]("Amount must be greater than 0!", "Withdrawal failed");
    var amountBN = Web3.utils.toBN((new Big(amount)).mul((new Big(10)).pow(token == "ETH" ? 18 : App.tokens[token].decimals)).toFixed());

    $('#withdrawButton').prop("disabled", true);
    $('#withdrawButton').text("...");

    await (async function() {
      App.getDirectlyWithdrawableCurrencies();

      // Approve RFT to RariFundManager
      try {
        var allowanceBN = Web3.utils.toBN(await App.contracts.RariFundToken.methods.allowance(App.selectedAccount, App.contracts.RariFundManager.options.address).call());
        if (allowanceBN.lt(Web3.utils.toBN(2).pow(Web3.utils.toBN(256)).subn(1))) await App.contracts.RariFundToken.methods.approve(App.contracts.RariFundManager.options.address, Web3.utils.toBN(2).pow(Web3.utils.toBN(256)).subn(1)).send({ from: App.selectedAccount });
      } catch (error) {
        return toastr["error"]("Failed to approve RFT to RariFundManager: " + error, "Withdrawal failed");
      }

      // See how much we can withdraw directly if token is not ETH
      var tokenRawFundBalanceBN = Web3.utils.toBN(0);

      if (["DAI", "USDC", "USDT"].indexOf(token) >= 0) {
        try {
          tokenRawFundBalanceBN = Web3.utils.toBN(await App.contracts.RariFundManager.methods["getRawFundBalance(string)"](token).call());
        } catch (error) {
          return toastr["error"]("Failed to get raw fund balance of output currency: " + error, "Withdrawal failed");
        }
      }

      if (tokenRawFundBalanceBN.gte(amountBN)) {
        // If we can withdraw everything directly, do so
        $('#WithdrawSlippage').hide();
        console.log('Withdraw ' + amountBN + ' of ' + amount + ' ' + token + ' directly');
        await App.contracts.RariFundManager.methods.withdraw(token, amountBN).send({ from: App.selectedAccount });
      } else {
        // Otherwise, exchange as few currencies as possible (ideally those with the lowest balances)
        var inputCurrencyCodes = [];
        var inputAmountBNs = [];
        var allOrders = [];
        var allSignatures = [];
        var makerAssetFillAmountBNs = [];
        var protocolFeeBNs = [];

        var amountInputtedUsdBN = Web3.utils.toBN(0);
        var amountWithdrawnBN = Web3.utils.toBN(0);
        var totalProtocolFeeBN = Web3.utils.toBN(0);

        // Get input candidates
        var inputCandidates = [];
        for (const inputToken of ["DAI", "USDC", "USDT"]) {
          if (inputToken === token && tokenRawFundBalanceBN.gt(Web3.utils.toBN(0))) {
            // Withdraw as much as we can of the output token first
            inputCurrencyCodes.push(token);
            inputAmountBNs.push(tokenRawFundBalanceBN);
            allOrders.push([]);
            allSignatures.push([]);
            makerAssetFillAmountBNs.push(0);
            protocolFeeBNs.push(0);

            amountInputtedUsdBN.iadd(tokenRawFundBalanceBN.mul(Web3.utils.toBN(1e18)).div(Web3.utils.toBN(10 ** (token == "ETH" ? 18 : App.tokens[token].decimals))));
            amountWithdrawnBN.iadd(tokenRawFundBalanceBN);
          } else {
            // Push other candidates to array
            var rawFundBalanceBN = Web3.utils.toBN(await App.contracts.RariFundManager.methods["getRawFundBalance(string)"](inputToken).call());
            if (rawFundBalanceBN.gt(Web3.utils.toBN(0))) inputCandidates.push({ currencyCode: inputToken, rawFundBalanceBN });
          }
        }

        // Get orders from 0x swap API for each input currency candidate
        for (var i = 0; i < inputCandidates.length; i++) {
          try {
            var [orders, inputFilledAmountBN, protocolFee, takerAssetFilledAmountBN, makerAssetFilledAmountBN, gasPrice] = await App.get0xSwapOrders(App.tokens[inputCandidates[i].currencyCode].address, token === "ETH" ? "WETH" : App.tokens[token].address, inputCandidates[i].rawFundBalanceBN, amountBN);
          } catch (err) {
            return toastr["error"]("Failed to get swap orders from 0x API: " + err, "Withdrawal failed");
          }

          // Build array of orders and signatures
          var signatures = [];

          for (var j = 0; j < orders.length; j++) {
            signatures[j] = orders[j].signature;
            
            orders[j] = {
              makerAddress: orders[j].makerAddress,
              takerAddress: orders[j].takerAddress,
              feeRecipientAddress: orders[j].feeRecipientAddress,
              senderAddress: orders[j].senderAddress,
              makerAssetAmount: orders[j].makerAssetAmount,
              takerAssetAmount: orders[j].takerAssetAmount,
              makerFee: orders[j].makerFee,
              takerFee: orders[j].takerFee,
              expirationTimeSeconds: orders[j].expirationTimeSeconds,
              salt: orders[j].salt,
              makerAssetData: orders[j].makerAssetData,
              takerAssetData: orders[j].takerAssetData,
              makerFeeAssetData: orders[j].makerFeeAssetData,
              takerFeeAssetData: orders[j].takerFeeAssetData
            };
          }

          inputCandidates[i].orders = orders;
          inputCandidates[i].signatures = signatures;
          inputCandidates[i].inputFillAmountBN = inputFilledAmountBN;
          inputCandidates[i].protocolFee = protocolFee;
          inputCandidates[i].takerAssetFillAmountBN = takerAssetFilledAmountBN;
          inputCandidates[i].makerAssetFillAmountBN = makerAssetFilledAmountBN;
        }

        // Sort candidates from lowest to highest takerAssetFillAmount
        inputCandidates.sort((a, b) => a.makerAssetFillAmountBN.gt(b.makerAssetFillAmountBN) ? 1 : -1);

        console.log(inputCandidates);

        // Loop through input currency candidates until we fill the withdrawal
        for (var i = 0; i < inputCandidates.length; i++) {
          // If there is enough input in the fund and enough 0x orders to fulfill the rest of the withdrawal amount, withdraw and exchange
          if (inputCandidates[i].makerAssetFillAmountBN.gte(amountBN.sub(amountWithdrawnBN))) {
            var thisOutputAmountBN = amountBN.sub(amountWithdrawnBN);
            var thisInputAmountBN = inputCandidates[i].inputFillAmountBN.mul(thisOutputAmountBN).div(inputCandidates[i].makerAssetFillAmountBN);
            
            console.log(thisOutputAmountBN.toString(), thisInputAmountBN.toString(), inputCandidates[i].makerAssetFillAmountBN.mul(thisInputAmountBN).div(inputCandidates[i].inputFillAmountBN).toString());
            var tries = 0;
            while (inputCandidates[i].makerAssetFillAmountBN.mul(thisInputAmountBN).div(inputCandidates[i].inputFillAmountBN).lt(thisOutputAmountBN)) {
              if (tries >= 1000) return toastr["error"]("Failed to get increment order input amount to achieve desired output amount: " + err, "Withdrawal failed");
              thisInputAmountBN.iadd(Web3.utils.toBN(1)); // Make sure we have enough input fill amount to achieve this maker asset fill amount
              tries++;
            }
            console.log(thisOutputAmountBN.toString(), thisInputAmountBN.toString(), inputCandidates[i].makerAssetFillAmountBN.mul(thisInputAmountBN).div(inputCandidates[i].inputFillAmountBN).toString());

            inputCurrencyCodes.push(inputCandidates[i].currencyCode);
            inputAmountBNs.push(thisInputAmountBN);
            allOrders.push(inputCandidates[i].orders);
            allSignatures.push(inputCandidates[i].signatures);
            makerAssetFillAmountBNs.push(thisOutputAmountBN);
            protocolFeeBNs.push(Web3.utils.toBN(inputCandidates[i].protocolFee));

            amountInputtedUsdBN.iadd(thisInputAmountBN.mul(Web3.utils.toBN(1e18)).div(Web3.utils.toBN(inputCandidates[i].currencyCode === "DAI" ? 1e18 : 1e6)));
            amountWithdrawnBN.iadd(thisOutputAmountBN);
            totalProtocolFeeBN.iadd(Web3.utils.toBN(inputCandidates[i].protocolFee));

            break;
          }

          // Add all that we can of the last one, then go through them again
          if (i == inputCandidates.length - 1) {
            inputCurrencyCodes.push(inputCandidates[i].currencyCode);
            inputAmountBNs.push(inputCandidates[i].inputFillAmountBN);
            allOrders.push(inputCandidates[i].orders);
            allSignatures.push(inputCandidates[i].signatures);
            makerAssetFillAmountBNs.push(inputCandidates[i].makerAssetFillAmountBN);
            protocolFeeBNs.push(Web3.utils.toBN(inputCandidates[i].protocolFee));

            amountInputtedUsdBN.iadd(inputCandidates[i].inputFillAmountBN.mul(Web3.utils.toBN(1e18)).div(Web3.utils.toBN(inputCandidates[i].currencyCode === "DAI" ? 1e18 : 1e6)));
            amountWithdrawnBN.iadd(inputCandidates[i].makerAssetFillAmountBN);
            totalProtocolFeeBN.iadd(Web3.utils.toBN(inputCandidates[i].protocolFee));

            i = -1;
            inputCandidates.pop();
          }

          // Stop if we have filled the withdrawal
          if (amountWithdrawnBN.gte(amountBN)) break;
        }
        
        // Make sure input amount is completely filled
        if (amountWithdrawnBN.lt(amountBN)) {
          $('#WithdrawAmount').val(amountWithdrawnBN.toString() / (["DAI", "ETH"].indexOf(token) >= 0 ? 1e18 : 1e6));
          return toastr["warning"]("Unable to find enough liquidity to exchange withdrawn tokens to " + token + ".", "Withdrawal canceled");
        }

        // Warn user of slippage
        var amountOutputtedUsd = amount * (await App.get0xPrice("DAI", token === "ETH" ? "WETH" : token)); // TODO: Use actual input currencies instead of using DAI for USD price
        var slippage = 1 - (amountOutputtedUsd / (amountInputtedUsdBN.toString() / 1e18));
        var slippageAbsPercentageString = Math.abs(slippage * 100).toFixed(3);

        if (!$('#WithdrawSlippage').is(':visible')) {
          $('#WithdrawSlippage').html(slippage >= 0 ? 'Slippage: <kbd class="text-' + (slippageAbsPercentageString === "0.000" ? "info" : "danger") + '">' + slippageAbsPercentageString + '%</kbd>' : 'Bonus: <kbd class="text-success">' + slippageAbsPercentageString + '%</kbd>').show();
          return toastr["warning"]("Please note the exchange slippage required to make a withdrawal of this currency.", "Please try again");
        }

        if ($('#WithdrawSlippage kbd').text() !== slippageAbsPercentageString + "%") {
          $('#WithdrawSlippage').html(slippage >= 0 ? 'Slippage: <kbd class="text-' + (slippageAbsPercentageString === "0.000" ? "info" : "danger") + '">' + slippageAbsPercentageString + '%</kbd>' : 'Bonus: <kbd class="text-success">' + slippageAbsPercentageString + '%</kbd>').show();
          return toastr["warning"]("Exchange slippage changed.", "Please try again");
        }

        console.log('Withdraw and exchange to ' + (amountWithdrawnBN.toString() / (["DAI", "ETH"].indexOf(token) >= 0 ? 1e18 : 1e6)) + ' ' + token);

        // Withdraw and exchange tokens via RariFundProxy
        try {
          var inputAmountStrings = [];
          for (var i = 0; i < inputAmountBNs.length; i++) inputAmountStrings[i] = inputAmountBNs[i].toString();
          var makerAssetFillAmountStrings = [];
          for (var i = 0; i < makerAssetFillAmountBNs.length; i++) makerAssetFillAmountStrings[i] = makerAssetFillAmountBNs[i].toString();
          var protocolFeeStrings = [];
          for (var i = 0; i < protocolFeeBNs.length; i++) protocolFeeStrings[i] = protocolFeeBNs[i].toString();
          console.log(inputCurrencyCodes, inputAmountStrings, token === "ETH" ? "ETH" : App.tokens[token].address, allOrders, allSignatures, makerAssetFillAmountStrings, protocolFeeStrings);
          await App.contracts.RariFundProxy.methods.withdrawAndExchange(inputCurrencyCodes, inputAmountStrings, token === "ETH" ? "0x0000000000000000000000000000000000000000" : App.tokens[token].address, allOrders, allSignatures, makerAssetFillAmountStrings, protocolFeeStrings).send({ from: App.selectedAccount, value: totalProtocolFeeBN, gasPrice: gasPrice, nonce: await App.web3.eth.getTransactionCount(App.selectedAccount) });
        } catch (err) {
          return toastr["error"]("RariFundProxy.withdrawAndExchange failed: " + err, "Withdrawal failed");
        }

        // Hide old slippage after exchange success
        $('#WithdrawSlippage').hide();
      }
      
      // Alert success and refresh balances
      toastr["success"]("Withdrawal of " + amount + " " + token + " confirmed!", "Withdrawal successful");
      $('#USDBalance').text("?");
      App.getFundBalance();
      $('#MyUSDBalance').text("?");
      App.getMyFundBalance();
      $('#RFTBalance').text("?");
      App.getTokenBalance();
      App.getDirectlyWithdrawableCurrencies();
    })();

    $('#withdrawButton').text("Withdraw");
    $('#withdrawButton').prop("disabled", false);
  },

  /**
   * Get the total balance of the quant fund in USD.
   */
  getFundBalance: function() {
    console.log('Getting fund balance...');

    App.contracts.RariFundManager.methods.getFundBalance().call().then(function(result) {
      $('#USDBalance').text((new Big(result)).div((new Big(10)).pow(18)).toFixed(8));
    }).catch(function(err) {
      console.error(err);
    });
  },

  /**
   * Get the user's account balance in the quant fund in USD.
   */
  getMyFundBalance: function() {
    console.log('Getting my fund balance...');

    App.contracts.RariFundManager.methods.balanceOf(App.selectedAccount).call().then(function(result) {
      $('#MyUSDBalance').text((new Big(result)).div((new Big(10)).pow(18)).toString());
    }).catch(function(err) {
      console.error(err);
    });
  },

  /**
   * Get the user's interest accrued in the quant fund in USD.
   */
  getMyInterestAccrued: function() {
    console.log('Getting my interest accrued...');

    App.contracts.RariFundManager.methods.interestAccruedBy(App.selectedAccount).call().then(function(result) {
      $('#MyInterestAccrued').text((new Big(result)).div((new Big(10)).pow(18)).toString());
    }).catch(function(err) {
      console.error(err);
    });
  },

  /**
   * Transfer RariFundToken.
   */
  handleTransfer: async function(event) {
    event.preventDefault();

    var amount = parseFloat($('#RFTTransferAmount').val());
    if (amount <= 0) return toastr["error"]("Amount must be greater than 0!", "Transfer failed");
    var amountBN = Web3.utils.toBN((new Big(amount)).mul((new Big(10)).pow(18)).toFixed());
    var toAddress = $('#RFTTransferAddress').val();

    $('#transferButton').prop("disabled", true);
    $('#transferButton').text("...");

    await (async function() {
      console.log('Transfer ' + amount + ' RFT to ' + toAddress);

      try {
        await App.contracts.RariFundToken.methods.transfer(toAddress, amountBN).send({ from: App.selectedAccount });
      } catch (err) {
        return toastr["error"](err, "Transfer failed");
      }

      toastr["success"]("Transfer of " + amount + " RFT confirmed!", "Transfer successful");
      $('#RFTBalance').text("?");
      App.getTokenBalance();
      $('#MyUSDBalance').text("?");
      App.getMyFundBalance();
    })();

    $('#transferButton').text("Transfer");
    $('#transferButton').prop("disabled", false);
  },

  /**
   * Get's the user's balance of RariFundToken.
   */
  getTokenBalance: function() {
    console.log('Getting token balance...');

    App.contracts.RariFundToken.methods.balanceOf(App.selectedAccount).call().then(function(result) {
      $('#RFTBalance').text((new Big(result)).div((new Big(10)).pow(18)).toString());
    }).catch(function(err) {
      console.error(err);
    });
  }

};

$(function() {
  $(document).ready(function() {
    App.init();
  });
});
