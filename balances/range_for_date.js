const moment = require('moment');

const {monthNumbers} = require('./constants');
const {monthOffset} = require('./constants');
const {notFoundIndex} = require('./constants');

const isDay = n => /^\d+$/.test(n) && Number(n) > 0;

/** Get a before and after range

  {
    [date]: <Day of Month String>
    [month]: <Month String>
    [year]: <Year String>
  }

  @throws
  <Error>

  @returns
  {
    [after]: <Records Created On or After ISO 8601 Date String>
    [before]: <Records Created Before ISO 8601 Date String>
  }
*/
module.exports = ({date, month, year}) => {
  if (!date && !year && !month) {
    return {};
  }

  const after = moment.utc().startOf('year');

  if (!!year) {
    after.year(year);
  }

  const end = after.clone();

  if (!!month && monthNumbers.indexOf(month) !== notFoundIndex) {
    [after, end].forEach(n => n.month(Number(month) - monthOffset));
  } else if (!!month) {
    [after, end].forEach(n => n.month(month));
  }

  if (!!date && (!isDay(date) || Number(date) > after.daysInMonth())) {
    throw new Error('ExpectedDayInMonthForAccountingDate');
  }

  if (!!date) {
    [after, end].forEach(n => n.date(Number(date)));
  }

  if (!!date) {
    end.add([date].length, 'day');
  } else if (!!month) {
    end.add([month].length, 'months');
  } else {
    end.add([after].length, 'years');
  }

  return {after: after.toISOString(), before: end.toISOString()};
};
