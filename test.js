const { sendMessageToPeer, subscribeToPeerMessages, pay, sendToChainAddress } = require("ln-service");
const lnd = require('./lnd');
const logger = require('@alexbosworth/caporal')
const decodeMessage = (n) => Buffer.from(n, 'hex').toString();
const encodeMessage = (n) => Buffer.from(JSON.stringify(n)).toString('hex');

async function test() {
  try {
    const l = (await lnd.authenticatedLnd({logger, node: 'bob'})).lnd;
    const getInfo = {
      "jsonrpc": "2.0",
      "method": "lsps1.get_info",
      "id": 5678,
      "params": {}
    }

    const createOrder = {
      "jsonrpc": "2.0",
      "method": "lsps1.create_order",
      "id": 5678,
      "params": {
        "lsp_balance_sat": "200000",
        "client_balance_sat": "0",
        "confirms_within_blocks": 2,
        "channel_expiry_blocks": 144,
        "token": "",
        "refund_onchain_address": "bc1qvmsy0f3yyes6z9jvddk8xqwznndmdwapvrc0xrmhd3vqj5rhdrrq6hz49h",
        "announce_channel": false
      },
    }

    const message = Buffer.from(JSON.stringify(getInfo)).toString('hex');

    await sendMessageToPeer({message, lnd: l, public_key: '02b4f62b6163043bcf3c4854b8a84947e64b8dc4c5ade7ed62d3d0e055ecec97ba', type: 37913})
    
    const sub = subscribeToPeerMessages({lnd: l});

    sub.on('message_received', async n => {
      try {
        if(getInfoResponse(n.message)) {
          await sendMessageToPeer({message: encodeMessage(createOrder), lnd: l, public_key: n.public_key, type: n.type});
        }
  
        console.log('message received', JSON.parse(decodeMessage(n.message)));
        const {invoice, address, amount} = createOrderResponse(n.message);
        if (!!invoice || !!address) {
          // const payinvoice = await pay({lnd: l, request: invoice});
  
          // console.log('pay invoice response', payinvoice);
          const payOnchain = await sendToChainAddress({lnd: l, address, tokens: Number(amount)});
  
          console.log('pay onchain response', payOnchain);
        }
      }
      catch(e) {
        console.log(e);
      }
    });

  } catch (e) {
    console.log(e);
  }
}


function createOrderResponse(message) {
  try {
    const msg = decodeMessage(message);
    const parsedMessge = JSON.parse(msg);

    if (!parsedMessge.result || !parsedMessge.result.payment){
      return {invoice: null, address: null, amount: null};
    }
    
    return {invoice: parsedMessge.result.payment.lightning_invoice, address: parsedMessge.result.payment.onchain_address, amount: parsedMessge.result.payment.order_total_sat};
  } catch(e) {
    console.log(e);
  }
}


function getInfoResponse(message) {
  try {
    const msg = decodeMessage(message);
    const parsedMessage = JSON.parse(msg);

    if (!parsedMessage.result || !parsedMessage.result.options) {
      return false;
    }
    return true;
  } catch(e) {
    console.log(e);
  }
}


test();