# issue-board-mcp

ตัวเชื่อม Claude เข้ากับ MCP server ของ **บอร์ดแจ้งปัญหา (issue board) ของคุณเอง** ด้วย token ส่วนตัว
รีโปนี้ **ไม่มีกติกาหรือสิทธิ์ใด ๆ** — server ที่คุณเชื่อมต่อเป็นผู้ตัดสินทุกอย่าง

## Claude Code

```text
/plugin marketplace add captainkie/issue-board-mcp
/plugin install issue-board@issue-board-mcp
```

ระบบจะถาม 2 ค่า:

- **Server URL** — ต้องขึ้นต้นด้วย `https://` เช่น `https://board.example.com/mcp`
- **Personal token** — เช่น `qat_EXAMPLE…` (เก็บใน keychain ของเครื่อง)

จากนั้นพิมพ์ `/mcp` เพื่อเช็กว่า `issue-board` เชื่อมต่อแล้ว

## Claude Desktop

1. ดาวน์โหลด `issue-board.mcpb` จากหน้า **Releases**
2. ดับเบิลคลิกไฟล์ แล้วกรอก Server URL และ token
3. เปิดใช้งานส่วนขยาย

## ตัวอย่างประโยคที่ใช้ได้

- "แจ้งบั๊กใหม่: หน้าโปรไฟล์ชื่อไม่ขึ้น"
- "ดูข้อของฉันที่รอเติมข้อมูล"
- "ตรวจข้อที่แก้แล้ว"
- "เทสตาม test case ของจอ A1"

ถ้า server ของคุณมี prompt ให้ จะใช้ได้ 4 ตัว ใน Claude Code จะขึ้นเป็น `/mcp__issue-board__<ชื่อ>` (พิมพ์ `/mcp__` เพื่อดูรายการจริง):

| Prompt | ใช้ทำอะไร |
| --- | --- |
| `report_bug` | แจ้งบั๊กใหม่ |
| `test_screen` | เทสตาม test case ของจอ… |
| `my_needs_info` | ดูข้อของฉันที่รอเติมข้อมูล |
| `verify_fixed` | ตรวจข้อที่แก้แล้ว (รอ QC) |

## ความปลอดภัย

- token เป็นของคุณคนเดียว **ห้ามวางในแชต** หรือส่งให้ใคร
- ถ้า token หลุด ให้เพิกถอนที่หน้า token ของบอร์ดทันที
- ส่วนขยาย Desktop บังคับ `https://` (ยกเว้น localhost) เพราะ token ถูกส่งไปกับทุกคำขอ

License: MIT
