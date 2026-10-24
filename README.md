# คู่มือการติดตั้งและใช้งาน LINE Bot ตรวจสอบสลิปการโอนเงิน (SlipVerify LINE Bot)

ระบบ LINE Bot อัตโนมัติสำหรับรับรูปสลิปจากลูกค้าในห้องแชท ตรวจสอบยอดเงิน และตอบกลับด้วย **LINE Flex Message** ใบเสร็จสีเขียวสวยงาม พร้อมระบบป้องกันการส่งสลิปซ้ำ

---

## สิ่งที่ต้องเตรียม (Checklist)

1. **บัญชี LINE Developers**:
   - เข้าเว็บ [https://developers.line.biz](https://developers.line.biz) แล้วสร้าง Messaging API Channel
   - สิ่งที่ต้องคัดลอกมา:
     - `Channel secret` (จากแท็บ Basic settings)
     - `Channel access token (long-lived)` (จากแท็บ Messaging API)

2. **บัญชีตรวจสลิป (SlipOK API)** (แนะนำ):
   - สมัครใช้งานที่ [https://slipok.com](https://slipok.com)
   - สิ่งที่ต้องคัดลอกมา:
     - `API Key`
     - `Branch ID` (ถ้ามี)
   *(หากยังไม่มี API Key ระบบจะมี Simulation Mode รองรับให้ทดสอบการทำงานของบอทได้ทันที)*

3. **Node.js**:
   - ตรวจสอบว่าในเครื่องมี Node.js หรือดาวน์โหลดได้ที่ [https://nodejs.org](https://nodejs.org) (เวอร์ชัน LTS)

---

## ขั้นตอนการติดตั้งและเริ่มใช้งาน

### 1. กำหนดค่าในไฟล์ `.env`
เปิดไฟล์ `line-bot/.env` แล้วกรอกค่าของคุณ:

```env
LINE_CHANNEL_ACCESS_TOKEN="ใส่ Channel access token ที่นี่"
LINE_CHANNEL_SECRET="ใส่ Channel secret ที่นี่"

SLIPOK_API_KEY="ใส่ SlipOK API Key ที่นี่"
SLIPOK_BRANCH_ID=""

MERCHANT_NAME="นาย มณฑลสรรค์ อินธิเดช"
PORT=3000
```

### 2. ติดตั้ง Dependencies และรันเซิร์ฟเวอร์
เปิด PowerShell หรือ Command Prompt เข้าไปที่โฟลเดอร์ `line-bot`:

```bash
cd line-bot
npm install
npm start
```
หรือดับเบิ้ลคลิกไฟล์ **`รัน-LINE-BOT.bat`** ได้ทันที

### 3. เปิดทางให้ LINE ส่ง Webhook เข้าเครื่อง (ทดสอบด้วย ngrok)
ดาวน์โหลด [ngrok](https://ngrok.com/download) แล้วรันคำสั่ง:

```bash
ngrok http 3000
```
คุณจะได้ Forwarding URL แบบ HTTPS เช่น:
`https://abc1-234-56-78.ngrok-free.app`

### 4. นำ URL ไปใส่ใน LINE Developers
1. ไปที่แท็บ **Messaging API** ใน LINE Developers Console
2. ที่หัวข้อ **Webhook settings**:
   - ใส่ Webhook URL: `https://abc1-234-56-78.ngrok-free.app/webhook`
   - เปิดสวิตช์ **Use webhook** เป็น **ON**
   - กดปุ่ม **Verify** (ต้องขึ้น Success)
3. ที่หัวข้อ **LINE Official Account features**:
   - ปิด **Auto-reply messages** (เพื่อให้บอทของเราเป็นผู้ตอบอย่างเดียว)

---

## การทำงานเมื่อลูกค้าส่งสลิป
1. ลูกค้าส่งรูปสลิปเข้ามาในแชท LINE
2. บอทจะดาวน์โหลดรูปภาพและส่งตรวจสอบยอดเงินจริง
3. บอทตอบกลับด้วยการ์ด Flex Message สีเขียว แสดง:
   - ✅ ยอดเงินตัวใหญ่ชัดเจน (เช่น `฿6,290.00`)
   - ชื่อผู้รับ (`นาย มณฑลสรรค์ อินธิเดช`)
   - ชื่อผู้โอน (`นาย ภานุวัฒน์ ทั่วดาล`)
   - วันเวลาและรหัสอ้างอิงธุรกรรม
4. หากลูกค้านำสลิปเดิมมาส่งซ้ำ บอทจะแจ้งเตือนการ์ดสีแดงทันทีว่า *"⚠️ ตรวจพบสลิปซ้ำ!"*
