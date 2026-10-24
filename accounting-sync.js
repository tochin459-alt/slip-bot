const axios = require('axios');

const FIRESTORE_URL = 'https://firestore.googleapis.com/v1/projects/tchin-ef062/databases/(default)/documents/accounting/main';

function jsToFirestoreValue(val) {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (Number.isInteger(val)) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map(jsToFirestoreValue)
      }
    };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      fields[k] = jsToFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function firestoreValueToJs(val) {
  if (!val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map(firestoreValueToJs);
  }
  if ('mapValue' in val) {
    const obj = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      obj[k] = firestoreValueToJs(v);
    }
    return obj;
  }
  return null;
}

async function recordSlipToAccounting({ amount, senderName, bankName, transDate, transRef }) {
  try {
    // 1. Fetch current document
    const getRes = await axios.get(FIRESTORE_URL);
    const fields = getRes.data.fields || {};

    let transactions = [];
    if (fields.transactions) {
      transactions = firestoreValueToJs(fields.transactions) || [];
    }

    // 2. Check if this transRef already exists
    if (transRef && transactions.some(t => t.ref === transRef)) {
      console.log(`[Accounting Sync] Transaction ${transRef} already recorded in accounting.`);
      return { success: true, alreadyRecorded: true };
    }

    // 3. Format Date (YYYY-MM-DD)
    let formattedDate = new Date().toISOString().slice(0, 10);
    if (transDate) {
      // If transDate is like 2026-10-24 or similar
      const dMatch = transDate.match(/\d{4}-\d{2}-\d{2}/);
      if (dMatch) {
        formattedDate = dMatch[0];
      }
    }

    // 4. Construct new transaction
    const newTx = {
      id: Date.now(),
      type: 'income',
      date: formattedDate,
      desc: `โอนเข้า LINE: ${senderName || 'ลูกค้า'}${bankName ? ` (${bankName})` : ''}`,
      category: 'ขายปลีกหน้าร้าน/ออนไลน์',
      amount: Number(amount) || 0,
      paymentMethod: 'bank',
      ref: transRef || `LINE-${Date.now()}`
    };

    transactions.unshift(newTx);

    // 5. Update Firestore
    const patchBody = {
      fields: {
        transactions: jsToFirestoreValue(transactions),
        updatedAt: jsToFirestoreValue(new Date().toISOString())
      }
    };

    const patchUrl = `${FIRESTORE_URL}?updateMask.fieldPaths=transactions&updateMask.fieldPaths=updatedAt`;
    const patchRes = await axios.patch(patchUrl, patchBody);

    console.log(`[Accounting Sync] 🚀 Successfully added ฿${amount} to accounting system! Status:`, patchRes.status);
    return { success: true, newTx };
  } catch (err) {
    console.error('[Accounting Sync] ❌ Failed to record transaction to Firebase:', err.response?.data || err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  recordSlipToAccounting,
  jsToFirestoreValue,
  firestoreValueToJs
};
