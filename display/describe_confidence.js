const {floor} = Math;

const bucketSize = 200000;

/** Map a confidence score into a description string

  {
    [confidence]: <Confidence Score Out of One Million Number>
  }

  @returns
  {
    [description]: <Confidence Score Text Description String>
  }
*/
module.exports = ({confidence}) => {
  if (!confidence) {
    return {};
  }

  const bucket = floor(confidence / bucketSize);

  switch (bucket) {
  case 5:
  case 4:
    return {description: '★ ★ ★ ★'};

  case 3:
    return {description: '★ ★ ★ ☆'};

  case 2:
    return {description: '★ ★ ☆ ☆'};

  case 1:
    return {description: '★ ☆ ☆ ☆'};

  default:
    return {};
  }
};
