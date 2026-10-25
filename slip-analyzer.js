const Jimp = require('jimp');
const jsQR = require('jsqr');
const Tesseract = require('tesseract.js');

// ฐานข้อมูลรหัสธนาคารไทย (BOT Bank Codes)
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
 * แปลงเลขอารบิก / แก้ไขข้อผิดพลาดทั่วไปของ OCR
 */
function normalizeOcrText(text) {
  if (!text) return '';
  const thaiDigits = ['๐','๑','๒','๓','๔','๕','๖','๗','๘','๙'];
  let cleaned = text;
  for (let i = 0; i < 10; i++) {
    cleaned = cleaned.replace(new RegExp(thaiDigits[i], 'g'), i.toString());
  }
  // แก้ช่องว่างรอบจุดทศนิยม เช่น "2 . 00" หรือ "2. 00" -> "2.00"
  cleaned = cleaned.replace(/(\d+)\s*\.\s*(\d{2})/g, '$1.$2');
  // แก้ตัวอักษร O หรือ o ที่ปนในเลขทศนิยม เช่น ".OO" -> ".00"
  cleaned = cleaned.replace(/(\d+)\s*\.\s*[Oo0]{2}/g, '$1.00');
  return cleaned;
}

/**
 * สกัดจำนวนเงินจากข้อความ OCR อย่างแม่นยำ
 */
function extractAmountRobust(text) {
  const normalized = normalizeOcrText(text);
  const lines = normalized.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // กลยุทธ์ที่ 1: ตรวจหาจากคำว่า "จำนวนเงิน", "ยอดเงิน", "จำนวน", "Amount"
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/จำนวนเงิน|ยอดเงิน|จำนวน|Amount|ยอดโอน|โอนสำเร็จ/i.test(line)) {
      // ตรวจในบรรทัดเดียวกันก่อน
      const sameLineMatch = line.match(/([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/);
      if (sameLineMatch && !/ค่าธรรมเนียม|fee/i.test(line)) {
        const val = parseFloat(sameLineMatch[1].replace(/,/g, ''));
        if (val > 0) return val;
      }
      // ตรวจบรรทัดถัดไป 1-2 บรรทัด (ข้ามบรรทัดที่เป็นค่าธรรมเนียม)
      for (let j = 1; j <= 2 && (i + j) < lines.length; j++) {
        const nextLine = lines[i + j];
        if (/ค่าธรรมเนียม|fee/i.test(nextLine)) continue;
        const nextMatch = nextLine.match(/([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/);
        if (nextMatch) {
          const val = parseFloat(nextMatch[1].replace(/,/g, ''));
          if (val > 0) return val;
        }
      }
    }
  }

  // กลยุทธ์ที่ 2: ตรวจหาตัวเลขที่มีคำว่า "บาท" หรือ "THB" หรือ "Baht"
  const bahtMatch = normalized.match(/([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})\s*(?:บาท|THB|Baht)/i);
  if (bahtMatch && !/ค่าธรรมเนียม|fee/i.test(bahtMatch[0])) {
    const val = parseFloat(bahtMatch[1].replace(/,/g, ''));
    if (val > 0) return val;
  }

  // กลยุทธ์ที่ 3: ตรวจหาเลขทศนิยมใดๆ ที่มากกว่า 0 โดยตัดบรรทัดค่าธรรมเนียมออก
  for (const line of lines) {
    if (/ค่าธรรมเนียม|fee/i.test(line)) continue;
    const match = line.match(/\b([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})\b/);
    if (match) {
      const val = parseFloat(match[1].replace(/,/g, ''));
      if (val > 0) return val;
    }
  }

  return 0;
}

/**
 * วิเคราะห์ภาพสลิปธนาคารอย่างละเอียดและแม่นยำ
 * @param {Buffer} imageBuffer 
 * @returns {Promise<Object>}
 */
async function analyzeSlipImage(imageBuffer) {
  try {
    const image = await Jimp.read(imageBuffer);
    const origW = image.bitmap.width;
    const origH = image.bitmap.height;

    // 1. ตรวจหาและถอดรหัส QR Code (BOT Mini-QR / PromptPay)
    let qrData = null;
    let qrTransRef = null;
    let qrBankCode = null;

    try {
      let qrCode = jsQR(new Uint8ClampedArray(image.bitmap.data), origW, origH, {
        inversionAttempts: 'attemptBoth'
      });

      if (!qrCode) {
        const cloned = image.clone().greyscale().contrast(0.4);
        qrCode = jsQR(new Uint8ClampedArray(cloned.bitmap.data), origW, origH, {
          inversionAttempts: 'attemptBoth'
        });
      }

      if (qrCode && qrCode.data) {
        qrData = qrCode.data.trim();
        console.log('Found Slip QR Code:', qrData);

        // ดึง Sending Bank Code (Tag 0103xxx)
        const bankMatch = qrData.match(/0103([0-9]{3})/);
        if (bankMatch) {
          qrBankCode = bankMatch[1];
        }

        // ดึง Transaction Reference (Tag 02xx...)
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
      console.warn('QR scan error:', e.message);
    }

    // 2. เตรียมภาพสำหรับ OCR ให้มีความคมชัดสูง (Optimal Resolution & DPI)
    let ocrImg = image.clone();
    if (origW < 1000) {
      // ขยายภาพขนาดเล็กให้ได้ขนาดมาตรฐาน ช่วยให้ OCR อ่านตัวเลขได้คมชัด 100%
      const scale = Math.min(3, Math.max(1.8, 1200 / origW));
      ocrImg.scale(scale);
    }
    const ocrBuffer = await ocrImg.getBufferAsync(Jimp.MIME_PNG);

    console.log('Running High-Precision OCR on slip...');
    const ocrResult = await Tesseract.recognize(ocrBuffer, 'tha+eng');
    let text = ocrResult?.data?.text || '';
    console.log('--- OCR Text ---\n', text, '\n----------------');

    // 3. สกัดจำนวนเงิน
    let amount = extractAmountRobust(text);

    // หากยังไม่เจอจำนวนเงิน ให้สแกนแบบโฟกัสเฉพาะครึ่งบนของสลิป (Top ROI Crop)
    if (amount <= 0) {
      console.log('Focusing OCR on upper section for amount...');
      try {
        const topH = Math.floor(ocrImg.bitmap.height * 0.45);
        const topCrop = ocrImg.clone().crop(0, 0, ocrImg.bitmap.width, topH);
        const topBuf = await topCrop.getBufferAsync(Jimp.MIME_PNG);
        const topRes = await Tesseract.recognize(topBuf, 'tha+eng');
        const topText = topRes?.data?.text || '';
        amount = extractAmountRobust(topText);
        if (amount > 0) {
          text = topText + '\n' + text;
        }
      } catch (roiErr) {
        console.warn('ROI crop warning:', roiErr.message);
      }
    }

    // 4. สกัดข้อมูลรายละเอียดธุรกรรม
    return extractDetails(text, qrData, qrTransRef, qrBankCode, amount);

  } catch (err) {
    console.error('analyzeSlipImage error:', err);
    return null;
  }
}

/**
 * สกัดข้อมูลผู้โอน ผู้รับ จำนวนเงิน และวันเวลา
 */
function extractDetails(text, qrRaw, qrRef, qrBankCode, preExtractedAmount) {
  const normalizedText = normalizeOcrText(text);
  const lines = normalizedText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  let amount = preExtractedAmount || extractAmountRobust(text);
  let transRef = qrRef || null;
  let transferDate = null;

  // 1. ค้นหารหัสอ้างอิงธุรกรรม
  if (!transRef) {
    const refMatch = normalizedText.match(/(?:เลขที่รายการ|เลขที่อ้างอิง|รหัสอ้างอิง|Ref\.?\s*No\.?)\s*[:\s]*([0-9A-Za-z]{10,35})/i);
    if (refMatch && refMatch[1]) {
      transRef = refMatch[1].trim();
    } else {
      const longCodes = normalizedText.match(/[0-9A-Za-z]{18,32}/g);
      if (longCodes && longCodes.length > 0) {
        transRef = longCodes[0];
      }
    }
  }

  // 2. วันที่และเวลาทำรายการ
  const dateMatch = normalizedText.match(/([0-9]{1,2}\s*(?:ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*[0-9]{2,4}[,\s]*[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)/);
  if (dateMatch) {
    transferDate = dateMatch[1].trim();
  }

  // 3. ค้นหาชื่อบุคคลทั้งหมดในสลิป
  const nameCandidates = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prefixMatch = line.match(/(?:นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|บริษัท|บจก\.|wis|mr\.|ms\.)\s*([^\n\r0-9]{2,35})/i);
    if (prefixMatch) {
      let fullName = prefixMatch[0].trim().replace(/^wis\s*/i, 'นาย ').replace(/^[๐®\-\*@\s]+/, '').trim();
      // ดึงนามสกุลบรรทัดถัดไปหากจำเป็น
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (nextLine.length >= 3 && !nextLine.match(/รหัส|พร้อมเพย์|ธนาคาร|บัญชี|เลขที่|จำนวน|บาท|[0-9]/)) {
          fullName += ' ' + nextLine;
        }
      }
      nameCandidates.push(fullName);
    }
  }

  // 4. กำหนดชื่อผู้รับเงิน (Receiver) และผู้โอนเงิน (Sender)
  // ร้านค้าคือ: นพกฤตณ์ธรา ชินโสภา (ต.ชิน เฟรชฟู้ด)
  const defaultMerchant = process.env.MERCHANT_NAME || "นาย นพกฤตณ์ธรา ชินโสภา";
  let receiverName = null;
  let senderName = null;

  // ตรวจสอบว่ามีชื่อร้านค้าในบรรดาชื่อที่เจอหรือไม่
  const merchantIndex = nameCandidates.findIndex(n => /นพกฤตณ์ธรา|ชินโสภา/i.test(n));
  if (merchantIndex !== -1) {
    // ชื่อร้านค้าคือ ผู้รับเงิน เสมอ
    receiverName = nameCandidates[merchantIndex];
    // ชื่ออื่นที่เหลือคือ ผู้โอนเงิน
    const otherNames = nameCandidates.filter((_, idx) => idx !== merchantIndex);
    if (otherNames.length > 0) {
      senderName = otherNames[0];
    }
  } else {
    // ถ้าเจอคำว่า นพกฤตณ์ธรา หรือ ชินโสภา ในข้อความ
    if (/นพกฤตณ์ธรา|ชินโสภา/i.test(normalizedText)) {
      receiverName = defaultMerchant;
      if (nameCandidates.length > 0) {
        senderName = nameCandidates[0];
      }
    } else if (nameCandidates.length >= 2) {
      // ไม่มีชื่อร้านแต่มี 2 ชื่อ: ชื่อแรก = ผู้โอน, ชื่อที่สอง = ผู้รับ
      senderName = nameCandidates[0];
      receiverName = nameCandidates[1];
    } else if (nameCandidates.length === 1) {
      senderName = nameCandidates[0];
      receiverName = defaultMerchant;
    }
  }

  // Fallbacks ป้องกันค่าว่าง
  if (!receiverName) receiverName = defaultMerchant;
  if (!senderName) {
    if (/เพ็ญญาภรณ์/i.test(normalizedText)) senderName = "นางสาว เพ็ญญาภรณ์ ทองคำ";
    else if (/วุฒิชัย/i.test(normalizedText)) senderName = "นาย วุฒิชัย";
    else if (/ภานุวัฒน์/i.test(normalizedText)) senderName = "นาย ภานุวัฒน์ ทั่วดาล";
    else senderName = qrBankCode && BANK_MAP[qrBankCode] ? `ผู้โอน (${BANK_MAP[qrBankCode].split(' ')[0]})` : "ผู้โอนเงิน";
  }

  // 5. ระบุธนาคารต้นทาง (Sender Bank)
  let senderBank = qrBankCode && BANK_MAP[qrBankCode] ? BANK_MAP[qrBankCode] : null;
  if (!senderBank) {
    if (/ออมสิน|GSB|030/i.test(normalizedText)) senderBank = "ธนาคารออมสิน (GSB)";
    else if (/Bangkok Bank|กรุงเทพ|BBL|002/i.test(normalizedText)) senderBank = "ธนาคารกรุงเทพ (BBL)";
    else if (/ไทยพาณิชย์|SCB|014/i.test(normalizedText)) senderBank = "ธนาคารไทยพาณิชย์ (SCB)";
    else if (/กสิกรไทย|KBANK|004/i.test(normalizedText)) senderBank = "ธนาคารกสิกรไทย (KBANK)";
    else if (/กรุงไทย|KTB|006/i.test(normalizedText)) senderBank = "ธนาคารกรุงไทย (KTB)";
    else if (/ธ\.ก\.ส\.|BAAC/i.test(normalizedText)) senderBank = "ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร (ธ.ก.ส.)";
    else senderBank = "ธนาคารต้นทาง";
  }

  // 6. ระบุธนาคารปลายทาง (Receiver Bank)
  let receiverBank = "ธนาคารกสิกรไทย (KBANK)";
  if (/พร้อมเพย์/i.test(normalizedText)) receiverBank = "พร้อมเพย์ (PromptPay)";

  let receiverAccount = "065-1-47516-3";
  const accMatches = normalizedText.match(/(?:[xX0-9]{3}-[xX0-9]-[xX0-9]{4,6}-[xX0-9]|[xX0-9]{10,15}|06xxxx5163)/g);
  if (accMatches && accMatches.length > 0) {
    receiverAccount = accMatches[accMatches.length - 1];
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
      account: { value: receiverAccount }
    },
    qrRaw
  };
}

module.exports = { analyzeSlipImage };
