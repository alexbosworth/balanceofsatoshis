/** Derive a prompt type from an argument type

  {
    type: <Prompt Type String>
  }

  @returns
  {
    [type]: <Sanitized Prompt Type String>
  }
*/
module.exports = ({type}) => {
  switch (type) {
  case 'checkbox':
  case 'confirm':
  case 'editor':
  case 'expand':
  case 'input':
  case 'number':
  case 'password':
  case 'rawlist':
  case 'search':
  case 'select':
    return {type};

  default:
    return {};
  }
};
