const moment = require('moment');

const defaultSegmentBy = 'created_at';

/** Fees for segment

  {
    [by]: <Segment By Attribute String>
    [end]: <End Date String>
    forwards: [{
      created_at: <Created At ISO 8601 Date String>
      fee: <Fee Tokens Number>
    }]
    measure: <Measure Time Period String>
    segments: <Segment Count Number>
  }

  @returns
  {
    count: [<Forwards Count In Segment Number>]
    fees: [<Fee Earnings In Segment Number>]
  }
*/
module.exports = ({by, end, forwards, measure, segments}) => {
  const fees = [...Array(segments)].map((_, i) => {
    const segment = moment(end).subtract(i, measure);

    const segmentForwards = forwards.filter(forward => {
      const forwardDate = moment(forward[by || defaultSegmentBy]);

      if (segment.year() !== forwardDate.year()) {
        return false;
      }

      const isSameDay = segment.dayOfYear() === forwardDate.dayOfYear();

      switch (measure) {
      case 'hour':
        return isSameDay && segment.hour() === forwardDate.hour();

      case 'week':
        return segment.week() === forwardDate.week();

      default:
        return isSameDay;
      }
    });

    return {
      count: segmentForwards.reduce((sum, {}) => ++sum, Number()),
      fees: segmentForwards.reduce((sum, {fee}) => sum + fee, Number()),
      forwarded: segmentForwards.reduce((sum, n) => sum + n.tokens, Number()),
    };
  });

  return {
    count: fees.map(({count}) => count).slice().reverse(),
    fees: fees.map(({fees}) => fees).slice().reverse(),
    forwarded: fees.map(({forwarded}) => forwarded).slice().reverse(),
  };
};
