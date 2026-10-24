require('dotenv').config();
const express = require('express');
const { middleware, Client } = require('@line/bot-sdk');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { createSuccessFlex, createDuplicateFlex, createWrongAccountFlex } = require('./flex-message');
const { analyzeSlipImage } = require('./slip-analyzer');
const { recordSlipToAccounting } = require('./accounting-sync');

// ตั้งค่า LINE Client Configuration
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.LINE_CHANNEL_SECRET || ''
};

const client = new Client(lineConfig);
const app = express();

// โครงสร้างเก็บประวัติ Transaction เพื่อกันสลิปซ้ำ (Duplicate Protection)
const HISTORY_FILE = path.join(__dirname, 'verified_slips.json');
let knownTransRefs = new Set();

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      knownTransRefs = new Set(data);
      console.log(`Loaded ${knownTransRefs.size} previous slip references.`);
    }
  } catch (err) {
    console.error('Error loading slip history:', err);
  }
}

function saveTransRef(ref) {
  if (!ref || typeof ref !== 'string' || ref.length < 8) return;
  knownTransRefs.add(ref);
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify([...knownTransRefs], null, 2));
  } catch (err) {
    console.error('Error saving slip history:', err);
  }
}

loadHistory();

// Health Check Endpoint
app.get('/', (req, res) => {
  res.send({
    status: 'online',
    service: 'Slip Verification LINE Bot',
    timestamp: new Date().toISOString()
  });
});

// LINE Webhook Endpoint
app.post('/webhook', middleware(lineConfig), async (req, res) => {
  try {
    const results = await Promise.all(
      req.body.events.map(event => handleEvent(event))
    );
    res.json(results);
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).end();
  }
});

/**
 * ฟังก์ชันจัดการ Event ที่ส่งมาจาก LINE
 */
async function handleEvent(event) {
  // รองรับเฉพาะ Event ส่งข้อความ (Message Event)
  if (event.type !== 'message') {
    return Promise.resolve(null);
  }

  // กรณีส่งรูปภาพ (ลูกค้าส่งสลิป)
  if (event.message.type === 'image') {
    return handleImageSlip(event);
  }

  // กรณีส่งข้อความตัวหนังสือ
  if (event.message.type === 'text') {
    const text = event.message.text.trim();
    if (text.includes('สลิป') || text.includes('เช็ค') || text.includes('โอน')) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '📸 คุณสามารถส่งรูปภาพสลิปการโอนเงินเข้ามาในแชทนี้ได้เลยครับ ระบบจะทำการตรวจสอบยอดเงินให้อัตโนมัติทันทีครับ'
      });
    }
  }

  return Promise.resolve(null);
}

/**
 * ดาวน์โหลดรูปภาพจาก LINE และส่งไปตรวจสอบ
 */
async function handleImageSlip(event) {
  try {
    console.log(`Receiving image message ID: ${event.message.id}`);

    // 1. ดาวน์โหลดรูปภาพจาก LINE Messaging API
    const stream = await client.getMessageContent(event.message.id);
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const imageBuffer = Buffer.concat(chunks);

    // 2. ส่งรูปภาพไปตรวจกับ SlipOK API
    const verifyResult = await verifyWithSlipOK(imageBuffer);

    if (!verifyResult || !verifyResult.success) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '❌ ไม่สามารถตรวจสอบสลิปนี้ได้ กรุณาตรวจสอบว่าภาพมีความคมชัดและมี QR Code ของธนาคารติดอยู่ครบถ้วนครับ'
      });
    }

    const slipData = verifyResult.data;
    const transRef = slipData.transRef || slipData.transId;

    // 3. ตรวจสอบว่าโอนเข้าบัญชีของทางร้าน (โหมดปลอดภัยสูงสุด: ปฏิเสธทันทีหากไม่ใช่บัญชีร้าน)
    const filterEnabled = process.env.ENABLE_ACCOUNT_FILTER === 'true';
    if (filterEnabled) {
      const expectedName = process.env.MERCHANT_NAME || 'นพกฤตณ์ธรา ชินโสภา';
      const expectedLast4 = process.env.COMPANY_ACCOUNT_LAST4 || '5163';
      const actualReceiverName = slipData.receiver?.name || '';
      const actualReceiverAcc = (slipData.receiver?.account?.value || '').replace(/[^0-9]/g, '');

      // ต้องมีชื่อ "นพกฤตณ์ธรา" หรือ "ชินโสภา" หรือเลขบัญชีลงท้ายด้วย "5163"
      const isNameMatch = actualReceiverName.includes('นพกฤตณ์ธรา') || actualReceiverName.includes('ชินโสภา');
      const isAccMatch = actualReceiverAcc.endsWith(expectedLast4);

      if (!isNameMatch && !isAccMatch) {
        console.warn(`🚨 Security Alert: Wrong receiver account! Actual: ${actualReceiverName} (${actualReceiverAcc})`);
        const wrongFlex = createWrongAccountFlex({
          expectedName,
          expectedAccount: '065-1-47516-3',
          actualReceiver: actualReceiverName ? `${actualReceiverName} (${slipData.receiver?.account?.value || 'บัญชีอื่น'})` : (slipData.receiver?.account?.value || 'บัญชีอื่น')
        });
        return client.replyMessage(event.replyToken, wrongFlex);
      }
    }

    // 4. ตรวจจับสลิปซ้ำ (Duplicate Detection)
    if (transRef && knownTransRefs.has(transRef)) {
      console.warn(`Duplicate slip detected! TransRef: ${transRef}`);
      const dupFlex = createDuplicateFlex({ transRef });
      return client.replyMessage(event.replyToken, dupFlex);
    }

    // 5. บันทึก Transaction Ref ป้องกันการนำมาใช้ซ้ำ
    if (transRef) {
      saveTransRef(transRef);
    }

    // 5.1 บันทึกยอดเงินเข้าระบบบัญชี T-Chin Fresh Food ทันที (Realtime Sync)
    try {
      console.log(`[LINE BOT] Syncing slip to T-Chin Accounting: ฿${slipData.amount}...`);
      await recordSlipToAccounting({
        amount: slipData.amount,
        senderName: slipData.sender?.name || 'ลูกค้า LINE',
        bankName: slipData.sender?.bank?.name || slipData.sender?.bank?.id || '',
        transDate: slipData.transDate,
        transRef: transRef
      });
    } catch (syncErr) {
      console.error('[LINE BOT] Failed to sync to accounting:', syncErr);
    }

    // 6. ส่ง Flex Message บิลยืนยันยอดเงินสำเร็จให้ลูกค้า
    const successFlex = createSuccessFlex({
      amount: slipData.amount,
      senderName: slipData.sender?.name || 'ผู้โอนเงิน',
      senderBank: slipData.sender?.bank?.name || slipData.sender?.bank?.id || 'ธนาคารต้นทาง',
      receiverName: slipData.receiver?.name || expectedName,
      receiverBank: slipData.receiver?.bank?.name || slipData.receiver?.bank?.id || 'บัญชีปลายทาง',
      receiverAccount: slipData.receiver?.account?.value || 'xxx-xxx-xxxx',
      transferDate: slipData.transDate || new Date().toLocaleString('th-TH'),
      transRef: transRef
    });

    return client.replyMessage(event.replyToken, successFlex);

  } catch (err) {
    console.error('Error processing slip image:', err);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '⚠️ เกิดข้อผิดพลาดในการตรวจสอบสลิป กรุณาลองใหม่อีกครั้ง หรือส่งรูปที่ชัดเจนขึ้นครับ'
    });
  }
}

/**
 * เรียก SlipOK API เพื่อยืนยันสลิปกับระบบธนาคาร
 */
/**
 * ตรวจสอบสลิป: ใช้ SlipOK API (หากมีคีย์) หรือใช้ OCR สแกนยอดเงินจริงจากรูปภาพ
 */
async function verifyWithSlipOK(imageBuffer) {
  const branchId = process.env.SLIPOK_BRANCH_ID;
  const apiKey = process.env.SLIPOK_API_KEY;

  // 1. หากมี SlipOK API Key ให้เรียกตรวจกับฐานข้อมูลธนาคาร
  if (apiKey && apiKey !== 'YOUR_SLIPOK_API_KEY') {
    try {
      console.log('Verifying with SlipOK API...');
      const formData = new FormData();
      formData.append('files', imageBuffer, { filename: 'slip.jpg', contentType: 'image/jpeg' });
      formData.append('log', 'true');

      const url = branchId 
        ? `https://api.slipok.com/api/line/apikey/${apiKey}?branch=${branchId}`
        : `https://api.slipok.com/api/line/apikey/${apiKey}`;

      const response = await axios.post(url, formData, {
        headers: {
          ...formData.getHeaders(),
          'x-authorization': apiKey
        },
        timeout: 10000
      });

      if (response.data && response.data.success) {
        return response.data;
      }
    } catch (err) {
      console.warn('SlipOK API request failed, falling back to local OCR:', err.response?.data || err.message);
    }
  }

  // 2. Local OCR Engine: อ่านตัวเลขยอดเงิน วันที่ และชื่อบัญชีจากรูปภาพจริงโดยตรง
  console.log('Using Local OCR Engine to scan slip image directly...');
  const analyzed = await analyzeSlipImage(imageBuffer);
  if (analyzed && analyzed.success) {
    return {
      success: true,
      data: analyzed
    };
  }

  return null;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🚀 Slip Verification LINE Bot is running on port ${PORT}`);
  console.log(`📍 Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`===============================================`);
});
