const moment = require('moment');

/** Fees for segment

  {
    forwards: [{
      created_at: <Created At ISO 8601 Date String>
      fee: <Fee Tokens Number>
    }]
    measure: <Measure Time Period String>
    segments: <Segment Count Number>
  }

  @returns
  {
    fees: [<Fee Earnings In Segment Number>]
  }
*/
module.exports = ({forwards, measure, segments}) => {
  const fees = [...Array(segments)].map((_, i) => {
    const segment = moment().subtract(i, measure);

    const segmentForwards = forwards.filter(forward => {
      const forwardDate = moment(forward.created_at);

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

    return segmentForwards.reduce((sum, {fee}) => sum + fee, Number());
  });

  return {fees: fees.slice().reverse()};
};
