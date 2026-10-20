---
name: issue-board
description: Use when the user wants to report a bug, look at their QA issues, answer a "needs info" request, verify a fix, or run test cases on the issue board (MCP server "issue-board"). Thai triggers too: แจ้งบั๊ก, ตรวจข้อที่แก้แล้ว, เทสตาม test case.
---

# วิธีใช้บอร์ด QA · Using the issue board

The server's own `instructions` and prompts are the source of truth and change without this plugin updating — **follow them first**. This skill only fixes the order:

1. `whoami` — learn the role and the last device the user tested on; ask whether it is still the same device.
2. Reporting: `draft_issue` with what the user said → ask **one field at a time** from `missing[]` → `update_draft`.
   For any pick-list field call `list_options` and offer the choices; never guess a screen, device or version.
   Out-of-list values go as `{"value": "...", "custom": true}` only after the user confirms.
3. Photos: give the user the `upload_url` (opens in their browser, valid 24h). Check `photos` on the draft/issue.
4. `submit_draft`. If the answer is `needs_confirmation`, show `similar[]` and ask "is it one of these?".
5. Every write carries a fresh `client_request_id`; on a network error resend the SAME one.
6. Errors carry `code` and `hint_th` — do what `hint_th` says.

ตอบผู้ใช้เป็นภาษาไทย · ถามทีละช่อง · ห้ามเดาจอหรืออุปกรณ์
