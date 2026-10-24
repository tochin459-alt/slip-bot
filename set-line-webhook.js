require('dotenv').config();
const axios = require('axios');

async function setWebhook(webhookUrl) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    console.error('Error: No LINE_CHANNEL_ACCESS_TOKEN found in .env');
    return false;
  }

  try {
    console.log(`Setting LINE Webhook endpoint to: ${webhookUrl}`);
    const res = await axios.put(
      'https://api.line.me/v2/bot/channel/webhook/endpoint',
      { endpoint: webhookUrl },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('LINE Webhook endpoint updated successfully!', res.data);

    // Test Webhook
    console.log('Testing LINE Webhook connection...');
    const testRes = await axios.post(
      'https://api.line.me/v2/bot/channel/webhook/test',
      { endpoint: webhookUrl },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('Webhook test result:', testRes.data);
    return true;
  } catch (err) {
    console.error('Failed to set or test webhook:', err.response?.data || err.message);
    return false;
  }
}

const targetUrl = process.argv[2];
if (targetUrl) {
  setWebhook(targetUrl);
} else {
  console.log('Usage: node set-line-webhook.js <webhook_url>');
}

module.exports = { setWebhook };
