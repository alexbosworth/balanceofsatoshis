const fetch = require('@alexbosworth/node-fetch');

//fetch result from method
module.exports = async ({body, contentType, method, url}) => {
  
  try {
    const response = await fetch(url, {
      body,
      contentType,
      method,
    });

    const data = await response.json();

    return data;

  } catch (err) {
    throw new Error(err);
  }
};
