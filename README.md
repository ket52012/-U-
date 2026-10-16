[DEPLOY .md](https://github.com/user-attachments/files/33582917/DEPLOY.1.md)
# U查询 — Cloudflare 部署教程

从零开始，把 `worker.js` 部署到 Cloudflare Workers 并跑起来。跟着做就行，不需要写代码。

---

## 一、准备工作

| 项目 | 说明 |
|---|---|
| Cloudflare 账号 | 到 [dash.cloudflare.com](https://dash.cloudflare.com) 免费注册一个 |
| `worker.js` | 本目录下的代码文件（已包含全部前后端） |
| 浏览器 | Chrome / Edge / Safari 均可 |

---

## 二、创建 Worker

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 左侧菜单 → **Workers and Pages** → **Create** → **Create Worker**
3. 起个名字（比如 `u-query`）→ **Deploy**
4. 点 **Edit code**（或 **Quick Edit**）进入代码编辑器
5. 把编辑器里的默认代码**全选删除**，把 `worker.js` 的全部内容**粘贴进去**
6. 点 **Save and deploy**（右上角）

此时访问 `https://你的名字.你的子域名.workers.dev` 应该能看到页面，但后台和查询还不能用，继续往下配。

---

## 三、创建 D1 数据库（存后台配置用）

1. 左侧菜单 → **Workers and Pages** → **D1 SQL Database**（或在搜索框搜 D1）
2. 点 **Create database**，名字随便起（比如 `u-query-settings`）→ **Create**
3. 记下这个数据库（后面绑定要用）

> 不建 D1 也能打开首页，但后台配置无法保存。建议建一个。

---

## 四、绑定 D1 到 Worker

1. 回到 **Workers and Pages** → 点你的 Worker（`u-query`）
2. **Settings** → **Bindings** → 点 **Add** → **D1 Database**
3. 变量名填 `DB`，数据库选第三步创建的那个，点 **Add binding**
4. 点 **Save** / **Deploy** 使生效

---

## 五、设置环境变量 / Secrets

在 Worker 的 **Settings** → **Variables and Secrets** 里添加：

### 必须设置

| 变量名 | 类型 | 说明 | 示例 |
|---|---|---|---|
| `ADMIN_PASSWORD` | Secret | 后台登录密码，自己定一个复杂的 | `aB3$xY9!qW8z` |

> 点 **Add** → 选 **Secret** 类型 → 变量名填 `ADMIN_PASSWORD` → 值填你的密码 → **Save**。

### 可选设置（不填也能用，有 Key 更稳定）

| 变量名 | 类型 | 说明 | 去哪申请 |
|---|---|---|---|
| `TRONGRID_KEY` | Secret | TronGrid API Key，提高 TRON 查询配额 | [trongrid.io](https://www.trongrid.io) 免费注册 |
| `ETHERSCAN_KEY` | Secret | Etherscan API Key，提高 ETH 查询配额 | [etherscan.io](https://etherscan.io) 免费注册 |

不填的话代码里有默认 Key 和公共节点兜底，一般查询不受影响。

设置完点 **Save and deploy**。

---

## 六、访问测试

| 地址 | 用途 |
|---|---|
| `https://你的名字.你的子域名.workers.dev/` | 首页：查余额、租能量、换 TRX |
| `https://你的名字.你的子域名.workers.dev/admin` | 后台：改标题、地址、客服、页底等配置 |

1. 打开首页，输入一个 TRON 或 ETH 地址点查询，能出余额和转账记录就是成功
2. 打开 `/admin`，输入第五步设置的 `ADMIN_PASSWORD` 登录，能保存配置就是成功

---

## 七、如何修改后台路径（把 /admin 换成别的）

默认后台路径是 `/admin`。想换成更隐蔽的（比如 `/mybackdoor123`），改两处：

**第 1 处** — 约第 800 行，路由判断：
```js
// 改之前
if (path === "/admin") {
// 改之后（换成你想要的路径）
if (path === "/mybackdoor123") {
```

**第 2 处** — 文件开头的注释（约第 108、668 行），只是注释说明，不改也能跑，建议顺手改掉方便以后认：
```js
// ---------- D1 设置（/admin 后台可改） ----------
```

改完重新 **Save and deploy**，以后就用新路径进后台，旧的 `/admin` 会返回 404。

> 路径命名建议：用别人猜不到的，比如 `/x7k2p9`，不要用 `/admin123` 这种常见的。

---

## 八、如何修改后台密码

密码存在环境变量 `ADMIN_PASSWORD` 里，**不要写在代码里**：

1. Worker → **Settings** → **Variables and Secrets**
2. 找到 `ADMIN_PASSWORD` → **Edit** → 改成新密码 → **Save**
3. 点 **Save and deploy** 使生效（改 Secret 后需要重新部署一次）

> 密码建议 12 位以上，含大小写字母+数字+符号。

---

## 九、功能清单（部署完自带）

| 功能 | 说明 |
|---|---|
| 查余额 | TRC20 / ETH 地址自动识别，余额 2 位小数 |
| 转账记录 | 最近 400 条，`+`/`-` 红绿区分，点哈希跳浏览器、点地址复制 |
| 安全检测 | 授权/多签分别显示，有风险标 ❗️ |
| 租能量 / 换 TRX | 首页卡片，后台可改文案和地址 |
| 实时汇率 | TRX/USDT、USDT/CNY 自动获取，后台可见实时价 |
| 分享预览 | Telegram / WhatsApp 分享显示标题+描述+配图 |
| 流星 + 卡片视差 | 纯视觉效果，不影响点击 |

---

## 十、常见问题

| 问题 | 解决办法 |
|---|---|
| 打开页面报 `error code: 1042` | 代码没部署成功，重新进 Quick Edit 粘贴 `worker.js` 并 Save and deploy |
| 后台登录一直转圈 | 检查 `ADMIN_PASSWORD` 是否设置，改完 Secret 要重新 Deploy |
| 后台保存配置没反应 | 检查 D1 是否创建、变量名是否为 `DB`（大写）并已绑定 |
| 查询没数据 / 超时 | 免费 TronGrid 配额有限，去申请 `TRONGRID_KEY` 填上 |
| 改了代码没生效 | Cloudflare 有几十秒缓存，等一分钟再刷新；或无痕模式打开 |

---

## 十一、文件说明

| 文件 | 说明 |
|---|---|
| `worker.js` | 完整代码，前后端都在里面，直接粘贴部署 |
| `DEPLOY.md` | 本教程 |

部署一次即可，后续改配置都在 `/admin` 后台点鼠标完成，不用再碰代码。
