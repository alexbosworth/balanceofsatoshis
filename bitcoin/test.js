const bitcoinCoreMethods = require('./bitcoin_core_methods');


(async () => {
  // code goes here
  try {
    const res = await bitcoinCoreMethods({
      core_method: 'getrawtransaction',
      param: ['f96fa779f6817dc90bd956bf3fcfa10358902ee9e924cdcdf28544bd6b88426d'],
    });
    console.log(res);
  }
  catch (err) {
    console.log(err);
  }
})();
