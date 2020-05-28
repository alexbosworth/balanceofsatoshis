const moment = require('moment');

/** Sums for segment for a chart

  {
    measure: <Measure Time Period String>
    records: [{
      date: <Created At ISO 8601 Date String>
      tokens: <Tokens To Sum Number>
    }]
    segments: <Segment Count Number>
  }

  @returns
  {
    count: [<Count In Segment Number>]
    sum: [<Sum In Segment Number>]
  }
*/
module.exports = ({measure, records, segments}) => {
  const sums = [...Array(segments)].map((_, i) => {
    const segment = moment().subtract(i, measure);

    const segmentTotals = records.filter(record => {
      const recordDate = moment(record.date);

      if (segment.year() !== recordDate.year()) {
        return false;
      }

      const isSameDay = segment.dayOfYear() === recordDate.dayOfYear();

      switch (measure) {
      case 'hour':
        return isSameDay && segment.hour() === recordDate.hour();

      case 'week':
        return segment.week() === recordDate.week();

      default:
        return isSameDay;
      }
    });

    return {
      count: segmentTotals.reduce((sum, {}) => ++sum, Number()),
      sum: segmentTotals.reduce((sum, {tokens}) => sum + tokens, Number()),
    };
  });

  return {
    count: sums.map(({count}) => count).slice().reverse(),
    sum: sums.map(({sum}) => sum).slice().reverse(),
  };
};
