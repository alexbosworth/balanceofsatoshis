const moment = require('moment');

const {monthNumbers} = require('./constants');
const {monthOffset} = require('./constants');
const {notFoundIndex} = require('./constants');

/** Get a before and after range 

  {
    [month]: <Month String>
    [year]: <Year String>
  }

  @throws
  <Error>

  @returns
  {
    [after]: <After ISO 8601 Date String>
    [before]: <Before ISO 8601 Date String>
  }
*/
module.exports = ({month, year}) => {
  if (!year && !month) {
    return {};
  }

  const after = moment.utc().startOf('year');

  if (!!year) {
    after.year(year);
  }

  try {
    after.toISOString();
  } catch (err) {
    throw new Error('UnrecognizedFormatForAccountingYear');
  }

  const end = after.clone();

  if (!!month && monthNumbers.indexOf(month) !== notFoundIndex) {
    [after, end].forEach(n => n.month(Number(month) - monthOffset));
  } else if (!!month) {
    [after, end].forEach(n => n.month(month));
  }

  if (!!month) {
    end.add([month].length, 'months');
  } else {
    end.add([after].length, 'years');
  }

  try {
    after.toISOString();
  } catch (err) {
    throw new Error('UnrecognizedFormatForAccountingMonth');
  }

  after.subtract([after].length, 'millisecond');

  return {after: after.toISOString(), before: end.toISOString()};
};
