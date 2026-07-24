const {evaluateFormula} = require('@alexbosworth/formulas');

const {assign} = Object;
const defaultVariables = {btc: 1e8, k: 1e3, m: 1e6, mm: 1e6};

/** Determine if variables are consistent with filters

  {
    filters: [<Filter Expression String>]
    variables: [{
      <Variable Name String>: <Variable Value Number>
    }]
  }

  @returns
  {
    [failure]: {
      error: <Error String>
      formula: <Errored Formula String>
    }
    [is_matching]: <Variables Are Consistent With Filters Bool>
  }
*/
module.exports = ({filters, variables}) => {
  // Exit early when there is nothing to match on
  if (!filters.length) {
    return {is_matching: true};
  }

  const vars = {};

  [defaultVariables, variables].forEach(variable => assign(vars, variable));

  const filtered = filters.map(formula => {
    try {
      return !evaluateFormula({constants: vars, formula}).result;
    } catch (err) {
      return {formula, error: err.message};
    }
  });

  const [errored] = filtered.filter(n => !!n.error);

  // Exit early when a filter resulted in an error
  if (!!errored && !!errored.error) {
    return {failure: {error: errored.error, formula: errored.formula}};
  }

  // Exit early when there is a filter hit
  if (!!filtered.filter(n => n !== false).length) {
    return {is_matching: false};
  }

  return {is_matching: true};
};
