/**
 * สร้าง LINE Flex Message สำหรับตอบกลับผลการตรวจสอบสลิป
 */

function createSuccessFlex(data) {
  const formattedAmount = Number(data.amount || 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  return {
    type: "flex",
    altText: `✅ ยืนยันการชำระเงินเรียบร้อย ฿${formattedAmount}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#059669",
        paddingAll: "20px",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: [
              {
                type: "text",
                text: "✓ ชำระเงินสำเร็จ",
                color: "#ffffff",
                weight: "bold",
                size: "lg"
              }
            ]
          },
          {
            type: "text",
            text: `฿${formattedAmount}`,
            color: "#ffffff",
            weight: "bold",
            size: "3xl",
            margin: "md"
          },
          {
            type: "text",
            text: "ตรวจสอบและบันทึกยอดเงินเรียบร้อย",
            color: "#d1fae5",
            size: "xs",
            margin: "xs"
          }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        paddingAll: "20px",
        contents: [
          // ผู้รับเงิน
          {
            type: "box",
            layout: "horizontal",
            contents: [
              {
                type: "text",
                text: "ผู้รับเงิน",
                size: "xs",
                color: "#94a3b8",
                flex: 3
              },
              {
                type: "text",
                text: data.receiverName || "บัญชีร้านค้า",
                size: "xs",
                weight: "bold",
                color: "#1e293b",
                align: "end",
                flex: 7,
                wrap: true
              }
            ]
          },
          // ธนาคารผู้รับ
          {
            type: "box",
            layout: "horizontal",
            contents: [
              {
                type: "text",
                text: "เข้าบัญชี",
                size: "xs",
                color: "#94a3b8",
                flex: 3
              },
              {
                type: "text",
                text: `${data.receiverBank || 'ธนาคาร'} (${data.receiverAccount || 'xxx-x-xxxxx'})`,
                size: "xs",
                color: "#475569",
                align: "end",
                flex: 7
              }
            ]
          },
          {
            type: "separator",
            margin: "md"
          },
          // ผู้โอนเงิน
          {
            type: "box",
            layout: "horizontal",
            contents: [
              {
                type: "text",
                text: "ผู้โอนเงิน",
                size: "xs",
                color: "#94a3b8",
                flex: 3
              },
              {
                type: "text",
                text: data.senderName || "ผู้โอน",
                size: "xs",
                weight: "bold",
                color: "#1e293b",
                align: "end",
                flex: 7,
                wrap: true
              }
            ]
          },
          // ธนาคารต้นทาง
          {
            type: "box",
            layout: "horizontal",
            contents: [
              {
                type: "text",
                text: "จากธนาคาร",
                size: "xs",
                color: "#94a3b8",
                flex: 3
              },
              {
                type: "text",
                text: data.senderBank || "ธนาคารต้นทาง",
                size: "xs",
                color: "#475569",
                align: "end",
                flex: 7
              }
            ]
          },
          // วัน-เวลา
          {
            type: "box",
            layout: "horizontal",
            contents: [
              {
                type: "text",
                text: "เวลาทำรายการ",
                size: "xs",
                color: "#94a3b8",
                flex: 3
              },
              {
                type: "text",
                text: data.transferDate || new Date().toLocaleString('th-TH'),
                size: "xs",
                color: "#475569",
                align: "end",
                flex: 7
              }
            ]
          },
          // รหัสอ้างอิง
          {
            type: "box",
            layout: "horizontal",
            contents: [
              {
                type: "text",
                text: "รหัสอ้างอิง",
                size: "xs",
                color: "#94a3b8",
                flex: 3
              },
              {
                type: "text",
                text: data.transRef || "-",
                size: "xxs",
                color: "#64748b",
                align: "end",
                flex: 7,
                wrap: true
              }
            ]
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "ขอบคุณที่ใช้บริการครับ 🙏",
            align: "center",
            size: "xs",
            color: "#94a3b8"
          }
        ],
        paddingAll: "15px"
      }
    }
  };
}

function createDuplicateFlex(data) {
  return {
    type: "flex",
    altText: "⚠️ สลิปนี้เคยถูกใช้งานไปแล้ว",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#e11d48",
        paddingAll: "20px",
        contents: [
          {
            type: "text",
            text: "⚠️ ตรวจพบสลิปซ้ำ!",
            color: "#ffffff",
            weight: "bold",
            size: "lg"
          },
          {
            type: "text",
            text: "สลิปนี้ถูกนำมาใช้ซ้ำแล้ว",
            color: "#ffe4e6",
            size: "xs",
            margin: "xs"
          }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        paddingAll: "20px",
        contents: [
          {
            type: "text",
            text: `รหัสอ้างอิง: ${data.transRef || '-'}`,
            size: "xs",
            color: "#64748b",
            wrap: true
          },
          {
            type: "text",
            text: "หากคิดว่าเป็นข้อผิดพลาด กรุณาติดต่อแอดมินเพื่อตรวจสอบโดยตรงครับ",
            size: "xs",
            color: "#334155",
            wrap: true
          }
        ]
      }
    }
  };
}

function createWrongAccountFlex(data) {
  return {
    type: "flex",
    altText: "⚠️ โอนไม่ตรงชื่อบัญชีของร้าน",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#e11d48",
        paddingAll: "20px",
        contents: [
          {
            type: "text",
            text: "⚠️ โอนไม่ตรงชื่อบัญชีของร้าน!",
            color: "#ffffff",
            weight: "bold",
            size: "lg"
          },
          {
            type: "text",
            text: "สลิปนี้ไม่ได้โอนเข้าชื่อบัญชีของทางร้าน",
            color: "#ffe4e6",
            size: "xs",
            margin: "xs"
          }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        paddingAll: "20px",
        contents: [
          {
            type: "text",
            text: "ชื่อบัญชีที่ถูกต้องของทางร้าน:",
            size: "xs",
            color: "#94a3b8"
          },
          {
            type: "text",
            text: `${data.expectedName || 'นพกฤตณ์ธรา ชินโสภา'}`,
            size: "md",
            weight: "bold",
            color: "#059669",
            wrap: true
          },
          {
            type: "text",
            text: `เลขที่บัญชี: ${data.expectedAccount || '065-1-47516-3'}`,
            size: "xs",
            color: "#475569",
            wrap: true
          },
          {
            type: "separator",
            margin: "md"
          },
          {
            type: "text",
            text: "ชื่อบัญชีปลายทางที่พบในสลิป:",
            size: "xs",
            color: "#94a3b8"
          },
          {
            type: "text",
            text: `${data.actualReceiver || 'ไม่ตรงกับชื่อบัญชีของร้าน'}`,
            size: "sm",
            weight: "bold",
            color: "#e11d48",
            wrap: true
          },
          {
            type: "text",
            text: "กรุณาตรวจสอบการโอนเงินใหม่อีกครั้ง หรือติดต่อเจ้าหน้าที่ครับ 🙏",
            size: "xs",
            color: "#64748b",
            margin: "md",
            wrap: true
          }
        ]
      }
    }
  };
}

module.exports = {
  createSuccessFlex,
  createDuplicateFlex,
  createWrongAccountFlex
};
