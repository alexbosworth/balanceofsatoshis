const {floor} = Math;
const {isArray} = Array;
const {random} = Math;

/** Shuffle array

  {
    array: [<Element Object>]
  }

  @returns
  {
    shuffled: [<Shuffled Element Object>]
  }
*/
module.exports = ({array}) => {
  if (!isArray(array)) {
    throw new Error('ExpectedArrayToShuffle');
  }

  if (!array.length) {
    return {shuffled: []};
  }

  const shuffled = array.slice();

  for (let i = shuffled.length - 1; !!i; i--) {
    const j = floor(random() * (i + 1));

    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return {shuffled};
};
