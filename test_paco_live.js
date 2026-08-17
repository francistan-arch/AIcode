const PacoService = require('./lib/paco');

async function testLivePaco() {
  console.log('======================================================');
  console.log('2C2P PACO v2.0 Live AirAsiaRewards Handshake Test');
  console.log('======================================================\n');

  const paco = new PacoService({ mode: 'sandbox' });

  try {
    const orderNo = `diagnose_${Date.now()}`;
    const result = await paco.createPaymentSession({
      invoiceNo: orderNo,
      description: 'AirAsia rewards Verification Handshake',
      amount: 50.50,
      currencyCode: 'THB'
    }, 'http://localhost:3000');

    console.log('\n🎉 LIVE 2C2P PACO SANDBOX SUCCESSFUL RESPONSE:');
    console.log(`Payment Page URL: ${result.webPaymentUrl}`);
    console.log('\nFull Decoded Response:');
    console.log(JSON.stringify(result.decodedResponse, null, 2));
  } catch (err) {
    console.error('\n❌ LIVE TEST ERROR:');
    console.error(err.message);
  }
}

testLivePaco();
