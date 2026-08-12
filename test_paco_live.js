const PacoService = require('./lib/paco');

async function testLivePaco() {
  console.log('======================================================');
  console.log('2C2P PACO v2.0 Live AirAsiaRewards Handshake Test');
  console.log('======================================================\n');

  const paco = new PacoService({ mode: 'sandbox' });

  try {
    const result = await paco.createPaymentSession({
      invoiceNo: `INV_TEST_${Date.now()}`,
      description: 'Test AirAsia Purchase',
      amount: 50.50,
      currencyCode: 'THB'
    }, 'http://localhost:3000');

    console.log('\n🎉 LIVE 2C2P PACO SANDBOX RESPONSE:');
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('\n❌ LIVE TEST ERROR:');
    console.error(err.message);
  }
}

testLivePaco();
