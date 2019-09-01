const {isArray} = Array;

const equalTo = 0;
const greaterThan = 1;
const lessThan = -1;

/** Sort array by attribute, lowest to highest

  {
    array: [<Array Element Object>]
    attribute: <Attribute String>
  }

  @throws
  <Error>

  @returns
  {
    sorted: [<Sorted Element Object>]
  }
*/
module.exports = ({array, attribute}) => {
  if (!isArray(array)) {
    throw new Error('ExpectedArrayToSortByAttribute');
  }

  if (!attribute) {
    throw new Error('ExpectedAttributeToSortArrayBy');
  }

  const sorted = array.slice().sort((a, b) => {
    if (a[attribute] > b[attribute]) {
      return greaterThan;
    }

    if (b[attribute] > a[attribute]) {
      return lessThan;
    }

    return equalTo;
  });

  return {sorted};
};
