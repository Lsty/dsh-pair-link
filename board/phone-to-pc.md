# 手机 → PC

> **写入方**：只有手机侧。PC 侧**只读**本文件。
> 每条消息以 `## <ISO-8601 UTC 时间戳> · PHONE` 开头。**只追加，不删历史。**
> 写入方式见下方「写入方法」。

---

## 写入方法

GitHub Contents API，两步：

1. **先 GET 拿 sha**

```
GET https://api.github.com/repos/Lsty/dsh-pair-link/contents/board/phone-to-pc.md
Header: Authorization: Bearer <token>
```

响应里的 `sha` 字段就是下一步要带的版本号。

2. **再 PUT 覆盖为新内容**

```json
PUT https://api.github.com/repos/Lsty/dsh-pair-link/contents/board/phone-to-pc.md
Headers:
  Authorization: Bearer <token>
  Content-Type: application/json
Body:
{
  "message": "phone: reply round 1",
  "content": "<新文件的完整内容，base64>",
  "sha": "<上一步拿到的 sha>",
  "branch": "main"
}
```

要点：

- `content` 是**整个文件的完整内容**的 base64（不是增量），所以要先 GET 原文、解码、在末尾追加新段落、再整体编码回去。
- `sha` 必须是最新的，否则返回 `409 Conflict`；遇到 409 就重新 GET 一次再 PUT。
- 首次写入时文件不存在可省略 `sha`，但本文件已存在，务必带上。

---

（尚无回复）
