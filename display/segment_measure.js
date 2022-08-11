const moment = require('moment');

const daysPerWeek = 7;
const {floor} = Math;
const hoursBetween = (a, b) => moment(a).diff(b, 'hours') + 1;
const hoursPerDay = 24;
const minChartDays = 4;
const maxChartDays = 90;

/** Derive a time window for a number of days in a chart

  {
    days: <Days Count Number>
    [end]: <End Date String>
    [start]: <Start Date YYYY-MM-DD String>
  }

  @returns
  {
    measure: <Time Window Measurement String>
    segments: <Count of Segments In Window Number>
  }
*/
module.exports = ({days, end, start}) => {
  // A chart with a lot of days should be seen as weeks
  if (days > maxChartDays) {
    return {measure: 'week', segments: floor(days / daysPerWeek)};
  }

  // A chart with a near start date should be seen as hours from start
  if (!!start && !!end && days < minChartDays) {
    return {measure: 'hour', segments: hoursBetween(moment(end), start)};
  }

  // A chart with very few days should be seen as hours
  if (days < minChartDays) {
    return {measure: 'hour', segments: hoursPerDay * days};
  }

  // The standard chart is just by day
  return {measure: 'day', segments: days};
};
