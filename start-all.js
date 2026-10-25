require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');
const axios = require('axios');

console.log('====================================================');
console.log('🚀 กำลังเริ่มต้นระบบ LINE Bot และ Tunnel อัตโนมัติ...');
console.log('====================================================');

// 1. รัน Server (Express)
const serverProcess = spawn('node', ['server.js'], {
  cwd: __dirname,
  stdio: 'inherit'
});

serverProcess.on('error', (err) => {
  console.error('Server process error:', err);
});

// 2. รัน Cloudflare Tunnel
const cloudflaredPath = path.join(__dirname, 'cloudflared.exe');
const tunnelProcess = spawn(cloudflaredPath, ['tunnel', '--url', 'http://localhost:3000'], {
  cwd: __dirname
});

let webhookUpdated = false;

tunnelProcess.stderr.on('data', async (data) => {
  const output = data.toString();
  // ค้นหา URL ของ trycloudflare
  const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
  if (match && !webhookUpdated) {
    webhookUpdated = true;
    const tunnelUrl = match[0].trim();
    const webhookUrl = `${tunnelUrl}/webhook`;

    console.log('\n----------------------------------------------------');
    console.log(`🌐 ได้รับ Public HTTPS URL: ${tunnelUrl}`);
    console.log(`📍 Webhook Endpoint: ${webhookUrl}`);
    console.log('----------------------------------------------------');

    // หน่วงเวลาและลองอัปเดต Webhook ซ้ำจนกว่า LINE จะยอมรับ
    setTimeout(async () => {
      await updateLineWebhookWithRetry(webhookUrl, 5);
    }, 6000);
  }
});

tunnelProcess.on('error', (err) => {
  console.error('Tunnel process error:', err);
});

async function updateLineWebhookWithRetry(webhookUrl, maxRetries = 5) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    console.error('❌ ไม่พบ LINE_CHANNEL_ACCESS_TOKEN ใน .env');
    return;
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 กำลังเชื่อมต่อและอัปเดต Webhook ไปยัง LINE (รอบที่ ${attempt}/${maxRetries})...`);
      await axios.put(
        'https://api.line.me/v2/bot/channel/webhook/endpoint',
        { endpoint: webhookUrl },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log('✅ ตั้งค่า Webhook บน LINE Platform สำเร็จเรียบร้อย!');

      // ทดสอบการเชื่อมต่อ
      console.log('🔍 กำลังทดสอบส่งสัญญาณ Webhook Test...');
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

      if (testRes.data?.success) {
        console.log('🎉 Webhook Test ผ่านฉลุย 100%! บอทเชื่อมต่อกับ LINE เรียบร้อยแล้ว');
        console.log('====================================================');
        console.log('👉 คุณสามารถลองส่งรูปสลิปในห้องแชท LINE ได้ทันทีเลยครับ!');
        console.log('====================================================\n');
        return;
      } else {
        console.log('Webhook test response:', testRes.data);
      }
      return;
    } catch (err) {
      console.warn(`รอบที่ ${attempt} ไม่สำเร็จ:`, err.response?.data?.message || err.message);
      if (attempt < maxRetries) {
        console.log('รอ 4 วินาทีแล้วลองใหม่...');
        await new Promise(r => setTimeout(r, 4000));
      } else {
        console.error('❌ ไม่สามารถอัปเดต Webhook บน LINE ได้ครบตามจำนวนรอบ');
      }
    }
  }
}

process.on('SIGINT', () => {
  serverProcess.kill();
  tunnelProcess.kill();
  process.exit();
});

process.on('SIGTERM', () => {
  serverProcess.kill();
  tunnelProcess.kill();
  process.exit();
});
