const columnDivider = ',';
const newLine = '\n';
const quoteMark = '"';

/** Get rows for table output from CSV

  {
    csv: <CSV String>
  }

  @returns
  {
    [rows]: [[<Column String>]]
  }
*/
module.exports = ({csv}) => {
  const entries = (csv || String()).split(newLine).map(line => {
    if (!line) {
      return [];
    }

    return line.split(columnDivider).map(val => {
      if (val[0] === quoteMark) {
        return val.slice(1, -1).slice(0, 32);
      }

      return parseFloat(val, 10).toFixed(4);
    });
  });

  const [header] = entries;

  const datedRecords = entries.slice([header].length)
    .sort((a, b) => a[2] > b[2] ? 1 : -1);

  const rows = [].concat([header]).concat(datedRecords);

  return {rows};
};
