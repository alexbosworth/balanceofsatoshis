const bitcoinCoreMethods = require('./bitcoin_core_methods');


(async () => {
  // code goes here
  try {
    const res = await bitcoinCoreMethods({
      core_method: 'getblockcount',
    });
    console.log(res);
  }
  catch (err) {
    console.log(err);
  }
})();
