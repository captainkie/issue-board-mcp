# issue-board-mcp

A connector that lets Claude talk to **your own issue board's MCP server** using a personal token.
This repo holds **no rules or permissions** — the server you connect to decides everything.

## Claude Code

```text
/plugin marketplace add captainkie/issue-board-mcp
/plugin install issue-board@issue-board-mcp
```

You will be asked for two values:

- **Server URL** — must start with `https://`, e.g. `https://board.example.com/mcp`
- **Personal token** — e.g. `qat_EXAMPLE…` (stored in your OS keychain)

Then run `/mcp` and check that `issue-board` shows as connected.

## Claude Desktop

1. Download `issue-board.mcpb` from **Releases**.
2. Double-click it and fill in the Server URL and token.
3. Turn the extension on.

## Things you can say

- "Report a new bug: the profile page does not show the name"
- "Show my issues that are waiting for more info"
- "Verify the issues that were fixed"
- "Run the test cases for screen A1"

If your server provides them, it also offers four prompts. In Claude Code they appear as `/mcp__issue-board__<name>` (type `/mcp__` to see the exact list):

| Prompt | What it starts |
| --- | --- |
| `report_bug` | report a new bug ("แจ้งบั๊กใหม่") |
| `test_screen` | run the test cases for a screen ("เทสตาม test case ของจอ…") |
| `my_needs_info` | issues waiting for more information from you ("ดูข้อของฉันที่รอเติมข้อมูล") |
| `verify_fixed` | check fixes that are waiting for QC ("ตรวจข้อที่แก้แล้ว (รอ QC)") |

## Security

- The token is personal. **Never paste it into a chat** or share it.
- If it leaks, revoke it on your board's token page right away.
- The Desktop extension requires `https://` (except localhost) because the token travels with every request.

License: MIT
