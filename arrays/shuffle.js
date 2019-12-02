const {floor} = Math;
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
  const shuffle = array.slice();

  if (!!shuffle.length) {
    for (let i = shuffle.length - 1; !!i; i--) {
      const j = floor(random() * (i + 1));

      [shuffle[i], shuffle[j]] = [shuffle[j], shuffle[i]];
    }
  }

  return {shuffled: shuffle};
};
