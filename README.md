# 提醒短信后台

这是一个本地可运行的网页后台原型，用来管理提醒任务，并在到点后触发短信发送。

## 功能

- 登录认证，默认管理员账号 `admin / 123`
- 管理员可创建新用户账号
- 普通用户登录后只看自己的提醒
- 创建一次性、每天、每周提醒
- 查看提醒列表、启用/停用、立即发送、删除
- SQLite 本地存储
- 后台定时扫描到期任务
- 支持 `mock` 模拟短信和 `webhook` 短信网关两种模式

## 启动

1. 安装依赖

```bash
npm install --cache ./.npm-cache
```

2. 复制环境变量

```bash
cp .env.example .env
```

3. 启动服务

```bash
npm start
```

4. 打开

[http://localhost:3000](http://localhost:3000)

## 登录

- 管理员账号：`admin`
- 管理员密码：`123`

管理员登录后可以在后台创建新用户。新用户登录后也可以独立使用提醒系统。

## 短信模式

### 1. mock

默认模式，不会真的发短信，只会在控制台和发送记录里留下模拟发送结果，方便先验证流程。

### 2. webhook

适合你已经有短信服务商接口，或者准备接一个内部网关。程序会向 `SMS_WEBHOOK_URL` 发一个 JSON POST：

```json
{
  "reminderId": 1,
  "phoneNumber": "13800138000",
  "message": "请在下午 3 点前联系客户"
}
```

如果配置了 `SMS_WEBHOOK_TOKEN`，会自动加上：

```http
Authorization: Bearer <token>
```

只要你的网关返回 2xx，系统就会把这次发送记为成功。

## 数据文件

- 数据库：[data/reminders.db](/Users/ken/Documents/New project/data/reminders.db)

首次启动会自动创建。
