# SHEIN 面单 URL 网页版

这是一个可以部署到 Vercel 的 Next.js 项目，用来查询 SHEIN 面单 PDF URL。

支持两种方式：

1. 上传 Excel 批量处理
   - A 列：店铺名
   - B 列：订单号
   - C 列：自动写入包裹号 / 面单号
   - D 列：自动写入面单 PDF URL
   - E 列：自动写入状态 / 错误原因
2. 手动输入订单号
   - 选择店铺
   - 输入 1 个或多个订单号
   - 页面直接显示结果
   - 可下载结果 Excel

> 注意：部署到 Vercel 后，网页不能直接读取用户电脑上的本地路径，例如 `C:\Users\...\1.xlsx`。这是浏览器安全限制。网页版使用“上传 Excel 文件”的方式。

---

## 1. 本地运行

```bash
npm install
cp .env.example .env.local
npm run dev
```

打开：

```text
http://localhost:3000
```

---

## 2. 配置店铺密钥

推荐在 `.env.local` 或 Vercel Environment Variables 里设置：

```env
SHEIN_STORE_KEYS_JSON='[
  {
    "storeName": "美区自运营7店",
    "openKeyId": "你的OpenKeyId",
    "secretKey": "你的SecretKey"
  },
  {
    "storeName": "美区自运营19店",
    "openKeyId": "你的OpenKeyId",
    "secretKey": "你的SecretKey"
  }
]'

SHEIN_DEFAULT_WORKERS=8
```

不要把 `.env.local` 上传到 GitHub。

---

## 3. 兼容旧版 store_key_all.txt 格式

如果你不想写 JSON，也可以用环境变量 `SHEIN_STORE_KEYS_TEXT`，内容支持你原来脚本的两种格式。

三行一组：

```text
美区自运营7店
OpenKeyId内容
SecretKey内容

美区自运营19店
OpenKeyId内容
SecretKey内容
```

或 key=value：

```text
店铺=美区自运营7店
OpenKeyId=OpenKeyId内容
SecretKey=SecretKey内容
```

部署到 Vercel 时，把这些文本直接粘贴到 `SHEIN_STORE_KEYS_TEXT` 环境变量即可。

---

## 4. 部署到 Vercel

1. 解压项目
2. 上传到 GitHub
3. 在 Vercel 新建 Project，选择这个 GitHub 仓库
4. 在 Vercel 的 Environment Variables 添加：
   - `SHEIN_STORE_KEYS_JSON`
   - 可选：`SHEIN_DEFAULT_WORKERS`
5. 点击 Deploy

---

## 5. Excel 模板

第一行表头建议如下：

| A列 | B列 | C列 | D列 |
| --- | --- | --- | --- |
| 店铺名 | 订单号 | 包裹号/面单号 | 网址 |

从第 2 行开始填数据。

---

## 6. 查询逻辑

服务端保留原脚本的主要流程：

1. 调用 `/open-api/order/order-detail` 获取订单详情
2. 从订单详情里解析 `packageNo` 和 `deliveryNo`
3. 优先使用 `deliveryNo` 调用 `/open-api/order/print-express-info`
4. 如果没有 `deliveryNo` 或没有拿到面单 URL，再使用 `packageNo` 兜底
5. 把面单号和 PDF URL 写回 Excel 或显示在页面上

---

## 7. 常见问题

### 页面提示“未配置 SHEIN_STORE_KEYS_JSON 或 SHEIN_STORE_KEYS_TEXT”

说明服务端没有读到店铺密钥。请检查：

- 本地是否创建 `.env.local`
- Vercel 是否配置了 Environment Variables
- 变量名是否完全一致
- JSON 格式是否正确

### 上传 Excel 后失败很多

常见原因：

- A 列店铺名和环境变量中的店铺名不一致
- 订单号不属于该店铺
- SHEIN 接口限流，建议降低并发数
- 某些订单没有返回 `deliveryNo` / `packageNo`

### 订单很多时超时

网页版运行在 Vercel Serverless 环境，订单特别多时可能受函数执行时间限制。建议分批上传，或把并发数调到 5-10。
