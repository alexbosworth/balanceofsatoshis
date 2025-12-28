const {join} = require('node:path');
const {readdirSync} = require('node:fs');
const {run} = require('node:test');
const {tap} = require('node:test/reporters');

const concurrency = 3;
const timeout = 1000 * 60 * 5;

const dirs = ['integration'];

const asPath = file => join(file.path || file.parentPath, file.name);
const flatten = arr => [].concat(...arr);

const files = flatten(dirs.map(dir => {
  return readdirSync(join(__dirname, dir), {withFileTypes: true}).map(asPath);
}));

run({concurrency, files, timeout}).compose(tap).pipe(process.stdout);
