const {noSpendPerms} = require('./constants');
const {permissionEntities} = require('./constants');

const readPerms = permissionEntities.map(entity => `${entity}:read`);

/** Derive restrictions for macaroon

  {
    [is_nospend]: <Restrict Credentials To Non-Spending Permissions Bool>
    [is_readonly]: <Restrict Credentials To Read-Only Permissions Bool>
    [methods]: [<Allow Specific Method String>]
  }

  @returns
  {
    [allow]: {
      methods: [<Allow Specific Method String>]
      permissions: [<Entity:Action String>]
    }
  }
*/
module.exports = args => {
  const methods = args.methods || [];

  // Exit early when specific credentials are not requested
  if (!args.is_readonly && !args.is_nospend && !methods.length) {
    return {};
  }

  const permissions = [];

  if (!!args.is_readonly) {
    readPerms.forEach(n => permissions.push(n));
  }

  if (!!args.is_nospend) {
    noSpendPerms.forEach(n => permissions.push(n));
  }

  return {allow: {methods, permissions}};
};