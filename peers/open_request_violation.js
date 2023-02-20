const {Parser} = require('hot-formula-parser');

const {isArray} = Array;
const {keys} = Object;

/** Find an open request violation

  {
    capacities: [<Existing Public Channel Capacity Tokens Number>]
    capacity: <Open Channel Capacity Tokens Number>
    channel_ages: [<Blocks Since Channel Open Number>]
    fee_rates: [<Outgoing Parts Per Million Fee Rate Number>]
    is_clearnet_only: <Requesting Clearnet Only peers>
    is_private: <Requesting Not Announced Channel Bool>
    local_balance: <Open Channel Gifted Tokens Number>
    public_key: <Open Channel Gifted Tokens Number>
    rules: [<Open Channel Request Rule String>]
  }

  @throws
  <Error>

  @returns
  {
    [rule]: <Rule String>
  }
*/
module.exports = args => {
  if (!isArray(args.capacities)) {
    throw new Error('ExpectedArrayOfCapacitiesToCheckForOpenRequestViolation');
  }

  if (!args.capacity) {
    throw new Error('ExpectedChannelCapacityToCheckForOpenRequestViolation');
  }

  if (!isArray(args.channel_ages)) {
    throw new Error('ExpectedChannelAgesArrayToCheckForOpenRequestViolation');
  }

  if (!isArray(args.fee_rates)) {
    throw new Error('ExpectedArrayOfFeeRatesToCheckForOpenRequestViolation');
  }

  if (args.is_clearnet_only === undefined) {
    throw new Error('ExpectedClearnetOnlyStatusToCheckOpenRequestRules');
  }

  if (args.is_private === undefined) {
    throw new Error('ExpectedChannelPrivateStatusToCheckOpenRequestRules');
  }

  if (args.local_balance === undefined) {
    throw new Error('ExpectedLocalBalanceToCheckForOpenRequestViolation');
  }

  if (!args.public_key) {
    throw new Error('ExpectedPeerrPublicKeyToCheckForOpenRequestViolation');
  }

  if (!isArray(args.rules)) {
    throw new Error('ExpectedArrayOfRulesToCheckForOpenRequestViolation');
  }

  const variables = {
    btc: 1e8,
    capacities: args.capacities,
    capacity: args.capacity,
    channel_ages: args.channel_ages,
    clearnet: args.is_clearnet_only,
    fee_rates: args.fee_rates,
    k: 1e3,
    local_balance: args.local_balance,
    m: 1e6,
    mm: 1e6,
    private: args.is_private,
    public_key: args.public_key,
  };

  const parser = new Parser();

  // Add the variables to the parser
  keys(variables).forEach(key => {
    parser.setVariable(key.toLowerCase(), variables[key]);
    parser.setVariable(key.toUpperCase(), variables[key]);

    return;
  });

  const violation = args.rules.find(rule => {
    const parsed = parser.parse(rule);

    switch (parsed.error) {
    case '#DIV/0!':
      throw new Error('CannotDivideByZeroInOpenRequestRule');

    case '#ERROR!':
      throw new Error('FailedToParseSpecifiedOpenRequestRule');

    case '#N/A':
    case '#NAME?':
      throw new Error('UnrecognizedVariableOrFunctionInRequestRule');

    case '#NUM':
      throw new Error('InvalidNumberFoundInRequestRule');

    case '#VALUE!':
      throw new Error('UnexpectedValueTypeInRequestRule');

    default:
      // Rules must evaluate as truthy
      return !parsed.result;
    }
  });

  return {rule: violation};
};
