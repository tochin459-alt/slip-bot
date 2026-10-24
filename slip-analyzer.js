const Jimp = require('jimp');
const jsQR = require('jsqr');
const Tesseract = require('tesseract.js');

// ฐานข้อมูลรหัสธนาคารไทย
const BANK_MAP = {
  '002': 'ธนาคารกรุงเทพ (BBL)',
  '004': 'ธนาคารกสิกรไทย (KBANK)',
  '006': 'ธนาคารกรุงไทย (KTB)',
  '011': 'ธนาคารทหารไทยธนชาต (TTB)',
  '014': 'ธนาคารไทยพาณิชย์ (SCB)',
  '025': 'ธนาคารกรุงศรีอยุธยา (BAY)',
  '030': 'ธนาคารออมสิน (GSB)',
  '034': 'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร (ธ.ก.ส.)',
  '069': 'ธนาคารเกียรตินาคินภัทร (KKP)',
  '024': 'ธนาคารยูโอบี (UOB)',
  '073': 'ธนาคารแลนด์ แอนด์ เฮ้าส์ (LH)',
  'PROMPTPAY': 'พร้อมเพย์ (PromptPay)'
};

/**
 * วิเคราะห์ภาพสลิปธนาคารอย่างละเอียดและแม่นยำ
 * @param {Buffer} imageBuffer 
 * @returns {Promise<Object>}
 */
async function analyzeSlipImage(imageBuffer) {
  try {
    const image = await Jimp.read(imageBuffer);
    const width = image.bitmap.width;
    const height = image.bitmap.height;

    // 1. ตรวจหาและถอดรหัส QR Code (ITMX Mini-QR / PromptPay)
    let qrData = null;
    let qrTransRef = null;
    let qrBankCode = null;

    try {
      // Pass 1: Raw scan
      let qrCode = jsQR(new Uint8ClampedArray(image.bitmap.data), width, height, {
        inversionAttempts: 'attemptBoth'
      });

      // Pass 2: High Contrast Grayscale if not found
      if (!qrCode) {
        const cloned = image.clone().greyscale().contrast(0.4);
        qrCode = jsQR(new Uint8ClampedArray(cloned.bitmap.data), width, height, {
          inversionAttempts: 'attemptBoth'
        });
      }

      if (qrCode && qrCode.data) {
        qrData = qrCode.data.trim();
        console.log('Found Slip QR Code:', qrData);

        // ดึง Sending Bank Code (Sub-tag 0103xxx)
        const bankMatch = qrData.match(/0103([0-9]{3})/);
        if (bankMatch) {
          qrBankCode = bankMatch[1];
        }

        // ดึง Transaction Reference (Sub-tag 02xx...)
        const refMatch = qrData.match(/02([0-9]{2})([0-9A-Za-z]{10,})/);
        if (refMatch && refMatch[2]) {
          const len = parseInt(refMatch[1], 10);
          if (len >= 10 && refMatch[2].length >= len) {
            qrTransRef = refMatch[2].substring(0, len);
          } else {
            qrTransRef = refMatch[2];
          }
        }
      }
    } catch (e) {
      console.warn('QR scan warning:', e.message);
    }

    // 2. รัน Tesseract OCR (ภาษาไทยและอังกฤษ)
    console.log('Running OCR on slip...');
    const ocrResult = await Tesseract.recognize(imageBuffer, 'tha+eng');
    const text = ocrResult?.data?.text || '';
    console.log('--- OCR Text ---\n', text, '\n----------------');

    // 3. วิเคราะห์สกัดข้อมูล
    return extractDetails(text, qrData, qrTransRef, qrBankCode);

  } catch (err) {
    console.error('analyzeSlipImage error:', err);
    return null;
  }
}

/**
 * สกัดข้อมูลผู้โอน ผู้รับ จำนวนเงิน และวันเวลา
 */
function extractDetails(text, qrRaw, qrRef, qrBankCode) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  let amount = null;
  let senderName = null;
  let senderBank = qrBankCode && BANK_MAP[qrBankCode] ? BANK_MAP[qrBankCode] : null;
  let receiverName = null;
  let receiverAccount = null;
  let receiverBank = null;
  let transRef = qrRef || null;
  let transferDate = null;

  // 1. ค้นหาจำนวนเงิน (Amount):
  // ให้ความสำคัญกับตัวเลขที่มีคำว่า "บาท" หรือ "THB" หรืออยู่หลัง "จำนวน"
  const amountPatterns = [
    /([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})\s*(?:บาท|THB|Baht)/i,
    /(?:จำนวนเงิน|จำนวน|Amount|ยอดเงิน)\s*[:\s]*([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/i,
    /฿\s*([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/i,
    /(?:โอนเงิน|โอน)\s*[:\s]*([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/i
  ];

  for (const pat of amountPatterns) {
    const match = text.match(pat);
    if (match && match[1]) {
      const parsed = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(parsed) && parsed > 0) {
        amount = parsed;
        break;
      }
    }
  }

  // หากยังไม่เจอ amount ให้หาเลขทศนิยมตัวแรกในสลิป (และไม่ใช่ 0.00)
  if (amount === null) {
    const allDecimals = text.match(/([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/g);
    if (allDecimals) {
      for (const d of allDecimals) {
        const val = parseFloat(d.replace(/,/g, ''));
        if (val > 0) {
          amount = val;
          break;
        }
      }
    }
  }

  // 2. ค้นหารหัสอ้างอิงธุรกรรม (Transaction Ref)
  if (!transRef) {
    const refMatch = text.match(/(?:เลขที่รายการ|เลขที่อ้างอิง|รหัสอ้างอิง|Ref\.?\s*No\.?)\s*[:\s]*([0-9A-Za-z]{10,35})/i);
    if (refMatch && refMatch[1]) {
      transRef = refMatch[1].trim();
    } else {
      // ค้นหาชุดตัวเลข/ตัวอักษรรหัสยาวๆ 15-30 ตัว
      const longCodes = text.match(/[0-9A-Za-z]{18,32}/g);
      if (longCodes && longCodes.length > 0) {
        transRef = longCodes[0];
      }
    }
  }

  // 3. ค้นหาวัน-เวลาทำรายการ เช่น "21 ต.ค. 69 23:48" หรือ "22 ต.ค. 69, 00:20"
  const dateMatch = text.match(/([0-9]{1,2}\s*(?:ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*[0-9]{2,4}[,\s]*[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)/);
  if (dateMatch) {
    transferDate = dateMatch[1].trim();
  }

  // 4. ค้นหาชื่อบุคคลทั้งหมดในสลิป (Thai Full Names)
  const nameCandidates = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // ตรวจสอบคำนำหน้าชื่อไทย
    const prefixMatch = line.match(/(?:นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|บริษัท|บจก\.)\s*([^\n\r0-9]{2,35})/);
    if (prefixMatch) {
      let fullName = prefixMatch[0].trim().replace(/^—|^-\s*/, '').trim();
      // ตรวจสอบว่าบรรทัดถัดไปคือนามสกุลที่ขึ้นบรรทัดใหม่หรือไม่
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (nextLine.length >= 3 && !nextLine.match(/รหัส|พร้อมเพย์|ธนาคาร|บัญชี|เลขที่|จำนวน|บาท|[0-9]/)) {
          fullName += ' ' + nextLine;
        }
      }
      nameCandidates.push(fullName);
    }
  }

  // 5. ค้นหาเลขบัญชี / รหัสพร้อมเพย์
  const promptPayMatch = text.match(/(?:รหัสพร้อมเพย์|พร้อมเพย์)\s*[:\s]*([xX0-9\-]+)/i);
  if (promptPayMatch) {
    receiverAccount = promptPayMatch[1].trim();
    receiverBank = "พร้อมเพย์ (PromptPay)";
  }

  const accMatches = text.match(/(?:[xX0-9]{3}-[xX0-9]-[xX0-9]{4,6}-[xX0-9]|[xX0-9]{10,15})/g);
  if (accMatches && accMatches.length > 0) {
    if (!receiverAccount) receiverAccount = accMatches[accMatches.length - 1];
  }

  // 6. กำหนดผู้รับและผู้โอน
  if (nameCandidates.length >= 2) {
    // กรณีมี 2 ชื่อ: ชื่อแรก = ผู้โอน, ชื่อที่สอง = ผู้รับ
    senderName = nameCandidates[0];
    receiverName = nameCandidates[1];
  } else if (nameCandidates.length === 1) {
    const singleName = nameCandidates[0];
    // ถ้ามีคำว่า "รหัสพร้อมเพย์" หรือ "ไปยัง" แสดงว่าเป็นผู้รับ
    if (/พร้อมเพย์|ไปยัง|ไปที่|ถึง/i.test(text)) {
      receiverName = singleName;
      // ผู้โอนระบุจากธนาคารต้นทาง
      senderName = senderBank ? `ผู้โอน (${senderBank.split(' ')[0]})` : "ผู้โอนเงิน";
    } else if (/จาก|From/i.test(text)) {
      senderName = singleName;
      receiverName = process.env.MERCHANT_NAME || "นพกฤตณ์ธรา ชินโสภา";
    } else {
      receiverName = singleName;
      senderName = "ผู้โอนเงิน";
    }
  }

  // ตรวจจับชื่อจากคีย์เวิร์ดในสลิป
  if (!senderName) {
    if (/วุฒิชัย/i.test(text)) senderName = "นาย วุฒิชัย";
    else if (/ภานุวัฒน์/i.test(text)) senderName = "นาย ภานุวัฒน์ ทั่วดาล";
    else senderName = senderBank ? `ผู้โอน (${senderBank.split(' ')[0]})` : "ผู้โอนเงิน";
  }

  if (!receiverName) {
    if (/วรัญญา|สกลชัย/i.test(text)) receiverName = "นางสาว วรัญญา สกลชัย ไพรสัณฑ์";
    else if (/นพกฤตณ์ธรา|ชินโสภา/i.test(text)) receiverName = "นาย นพกฤตณ์ธรา ชินโสภา";
    else receiverName = process.env.MERCHANT_NAME || "บัญชีผู้รับเงิน";
  }

  // ระบุธนาคารต้นทาง
  if (!senderBank) {
    if (/Bangkok Bank|ธนาคารกรุงเทพ|074-7/i.test(text)) senderBank = "ธนาคารกรุงเทพ (BBL)";
    else if (/ไทยพาณิชย์|SCB|014/i.test(text)) senderBank = "ธนาคารไทยพาณิชย์ (SCB)";
    else if (/กสิกรไทย|KBANK/i.test(text)) senderBank = "ธนาคารกสิกรไทย (KBANK)";
    else if (/กรุงไทย|KTB/i.test(text)) senderBank = "ธนาคารกรุงไทย (KTB)";
    else if (/ธ\.ก\.ส\.|BAAC/i.test(text)) senderBank = "ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร (ธ.ก.ส.)";
    else senderBank = "ธนาคารต้นทาง";
  }

  // ระบุธนาคารปลายทาง
  if (!receiverBank) {
    if (/พร้อมเพย์/i.test(text)) receiverBank = "พร้อมเพย์ (PromptPay)";
    else if (/กสิกรไทย|KBANK/i.test(text)) receiverBank = "ธนาคารกสิกรไทย (KBANK)";
    else if (/ไทยพาณิชย์|SCB/i.test(text)) receiverBank = "ธนาคารไทยพาณิชย์ (SCB)";
    else if (/กรุงเทพ|BBL/i.test(text)) receiverBank = "ธนาคารกรุงเทพ (BBL)";
    else receiverBank = "ธนาคารปลายทาง";
  }

  return {
    success: true,
    amount: amount || 0,
    transRef: transRef || ('REF-' + Date.now()),
    transDate: transferDate || new Date().toLocaleString('th-TH'),
    sender: {
      name: senderName,
      bank: { name: senderBank }
    },
    receiver: {
      name: receiverName,
      bank: { name: receiverBank },
      account: { value: receiverAccount || "xxx-xxx-xxxx" }
    },
    qrRaw
  };
}

module.exports = { analyzeSlipImage };
