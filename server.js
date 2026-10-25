require('dotenv').config();
const express = require('express');
const { middleware, Client } = require('@line/bot-sdk');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { createSuccessFlex, createUnclearSlipFlex, createDuplicateFlex, createWrongAccountFlex } = require('./flex-message');
const { analyzeSlipImage } = require('./slip-analyzer');
const { recordSlipToAccounting } = require('./accounting-sync');

// ข้อมูลร้านค้าและบัญชีรับเงิน
const DEFAULT_MERCHANT_NAME = process.env.MERCHANT_NAME || 'นาย นพกฤตณ์ธรา ชินโสภา';
const COMPANY_ACCOUNT_LAST4 = process.env.COMPANY_ACCOUNT_LAST4 || '5163';

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
    merchant: DEFAULT_MERCHANT_NAME,
    timestamp: new Date().toISOString()
  });
});

// ติดตาม Event ที่กำลังประมวลผลเพื่อป้องกันการทำซ้ำจาก LINE Webhook Retry
const processedEvents = new Map();

// LINE Webhook Endpoint
app.post('/webhook', middleware(lineConfig), (req, res) => {
  // ตอบกลับ 200 OK ทันทีภายใน 50ms เพื่อป้องกัน LINE Timeout & Webhook Retry
  res.status(200).json({ status: 'ok' });

  const events = req.body.events || [];
  for (const event of events) {
    const eventKey = event.webhookEventId || (event.message && event.message.id) || event.replyToken;
    if (eventKey && processedEvents.has(eventKey)) {
      console.log(`Skipping duplicate event delivery: ${eventKey}`);
      continue;
    }

    if (eventKey) {
      processedEvents.set(eventKey, Date.now());
      // คืนหน่วยความจำเก่าหลังจาก 10 นาที
      if (processedEvents.size > 500) {
        const now = Date.now();
        for (const [k, t] of processedEvents.entries()) {
          if (now - t > 600000) processedEvents.delete(k);
        }
      }
    }

    // ประมวลผล Event แบบ Asynchronous
    handleEvent(event).catch(err => {
      console.error(`Error handling event:`, err.message || err);
    });
  }
});

/**
 * ฟังก์ชันจัดการ Event ที่ส่งมาจาก LINE
 */
async function handleEvent(event) {
  // รองรับเฉพาะ Event ส่งข้อความ (Message Event)
  if (event.type !== 'message') {
    return null;
  }

  // กรณีส่งรูปภาพ (ลูกค้าส่งสลิป)
  if (event.message.type === 'image') {
    return handleImageSlip(event);
  }

  // กรณีส่งข้อความตัวหนังสือ
  if (event.message.type === 'text') {
    const text = event.message.text.trim();
    if (text.includes('สลิป') || text.includes('เช็ค') || text.includes('โอน') || text.includes('ยอด') || text.includes('บิล')) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '📸 คุณสามารถส่งรูปภาพสลิปการโอนเงินเข้ามาในแชทนี้ได้เลยครับ ระบบจะทำการตรวจสอบยอดเงิน ชื่อผู้รับ/ผู้โอน และบันทึกบัญชีให้อัตโนมัติทันทีครับ 🙏'
      }).catch(e => console.warn('Reply text warning:', e.message));
    }
  }

  return null;
}

/**
 * ดาวน์โหลดรูปภาพจาก LINE และส่งไปตรวจสอบ
 */
async function handleImageSlip(event) {
  try {
    console.log(`\n========================================`);
    console.log(`📥 Receiving slip image message ID: ${event.message.id}`);
    console.log(`========================================`);

    // 1. ดาวน์โหลดรูปภาพจาก LINE Messaging API
    const stream = await client.getMessageContent(event.message.id);
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const imageBuffer = Buffer.concat(chunks);

    // 2. ส่งรูปภาพไปตรวจ (SlipOK API หรือ Local High-Precision OCR)
    const verifyResult = await verifyWithSlipOK(imageBuffer);

    if (!verifyResult || !verifyResult.success || !verifyResult.data) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '❌ ไม่สามารถตรวจสอบสลิปนี้ได้ กรุณาตรวจสอบว่าภาพมีความคมชัดและมีตัวเลขยอดเงินครบถ้วนครับ'
      }).catch(e => console.warn('Reply error:', e.message));
    }

    const slipData = verifyResult.data;
    const transRef = slipData.transRef || slipData.transId;

    // 3. ป้องกันบัคยอดเงิน 0.00: หากตรวจไม่พบยอดเงิน (> 0) แจ้งให้ลูกค้าส่งรูปใหม่
    if (!slipData.amount || slipData.amount <= 0) {
      console.warn('🚨 Amount is 0 or null, rejecting verification');
      const unclearFlex = createUnclearSlipFlex(slipData);
      return client.replyMessage(event.replyToken, unclearFlex).catch(e => console.warn('Reply error:', e.message));
    }

    // 4. ตรวจสอบว่าโอนเข้าบัญชีของทางร้าน (โหมดปลอดภัยสูงสุด: ปฏิเสธทันทีหากไม่ใช่บัญชีร้าน)
    const filterEnabled = process.env.ENABLE_ACCOUNT_FILTER === 'true';
    if (filterEnabled) {
      const actualReceiverName = slipData.receiver?.name || '';
      const actualReceiverAcc = (slipData.receiver?.account?.value || '').replace(/[^0-9]/g, '');

      // ต้องมีชื่อ "นพกฤตณ์ธรา" หรือ "ชินโสภา" หรือเลขบัญชีลงท้ายด้วย "5163"
      const isNameMatch = actualReceiverName.includes('นพกฤตณ์ธรา') || actualReceiverName.includes('ชินโสภา');
      const isAccMatch = actualReceiverAcc.endsWith(COMPANY_ACCOUNT_LAST4);

      if (!isNameMatch && !isAccMatch) {
        console.warn(`🚨 Security Alert: Wrong receiver account! Actual: ${actualReceiverName} (${actualReceiverAcc})`);
        const wrongFlex = createWrongAccountFlex({
          expectedName: DEFAULT_MERCHANT_NAME,
          expectedAccount: '065-1-47516-3',
          actualReceiver: actualReceiverName ? `${actualReceiverName} (${slipData.receiver?.account?.value || 'บัญชีอื่น'})` : (slipData.receiver?.account?.value || 'บัญชีอื่น')
        });
        return client.replyMessage(event.replyToken, wrongFlex).catch(e => console.warn('Reply error:', e.message));
      }
    }

    // 5. ตรวจจับสลิปซ้ำ (Duplicate Detection)
    if (transRef && knownTransRefs.has(transRef)) {
      console.warn(`⚠️ Duplicate slip detected! TransRef: ${transRef}`);
      const dupFlex = createDuplicateFlex({ transRef });
      return client.replyMessage(event.replyToken, dupFlex).catch(e => console.warn('Reply error:', e.message));
    }

    // 6. บันทึก Transaction Ref ป้องกันการนำมาใช้ซ้ำ
    if (transRef) {
      saveTransRef(transRef);
    }

    // 7. บันทึกยอดเงินเข้าระบบบัญชี T-Chin Fresh Food ทันที (Realtime Sync to Firestore)
    try {
      console.log(`[LINE BOT] 📊 Syncing slip to T-Chin Accounting: ฿${slipData.amount}...`);
      await recordSlipToAccounting({
        amount: slipData.amount,
        senderName: slipData.sender?.name || 'ลูกค้า LINE',
        bankName: slipData.sender?.bank?.name || 'ธนาคาร',
        transDate: slipData.transDate,
        transRef: transRef
      });
    } catch (syncErr) {
      console.error('[LINE BOT] Failed to sync to accounting:', syncErr);
    }

    // 8. ส่ง Flex Message บิลยืนยันยอดเงินสำเร็จให้ลูกค้า
    console.log(`[LINE BOT] 🚀 Sending confirmation Flex Message: ฿${slipData.amount} (Sender: ${slipData.sender?.name}, Receiver: ${slipData.receiver?.name})...`);
    const successFlex = createSuccessFlex({
      amount: slipData.amount,
      senderName: slipData.sender?.name || 'ลูกค้า',
      senderBank: slipData.sender?.bank?.name || 'ธนาคารต้นทาง',
      receiverName: slipData.receiver?.name || DEFAULT_MERCHANT_NAME,
      receiverBank: slipData.receiver?.bank?.name || 'ธนาคารกสิกรไทย (KBANK)',
      receiverAccount: slipData.receiver?.account?.value || '065-1-47516-3',
      transferDate: slipData.transDate || new Date().toLocaleString('th-TH'),
      transRef: transRef
    });

    return client.replyMessage(event.replyToken, successFlex).catch(e => {
      console.error('Error replying success flex to LINE:', e.message || e);
    });

  } catch (err) {
    console.error('Error processing slip image:', err);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '⚠️ เกิดข้อผิดพลาดในการตรวจสอบสลิป กรุณาลองใหม่อีกครั้ง หรือส่งรูปที่ชัดเจนขึ้นครับ'
    }).catch(e => console.warn('Reply error:', e.message));
  }
}

/**
 * ตรวจสอบสลิป: ใช้ SlipOK API (หากมีคีย์) หรือใช้ Local High-Precision OCR Engine
 */
async function verifyWithSlipOK(imageBuffer) {
  const branchId = process.env.SLIPOK_BRANCH_ID;
  const apiKey = process.env.SLIPOK_API_KEY;

  // 1. หากมี SlipOK API Key ให้เรียกตรวจกับฐานข้อมูลธนาคาร
  if (apiKey && apiKey !== 'YOUR_SLIPOK_API_KEY' && apiKey.trim().length > 5) {
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

  // 2. Local OCR Engine: สแกนยอดเงินจริง วันที่ และชื่อบัญชีจากรูปภาพโดยตรง
  console.log('Using Local High-Precision OCR Engine to scan slip image directly...');
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
  console.log(`👤 Merchant: ${DEFAULT_MERCHANT_NAME}`);
  console.log(`===============================================`);
});
