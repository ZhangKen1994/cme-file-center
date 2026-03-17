# CME 文件后台云端部署

这是一份专门给 `CME 文件后台` 用的云端部署说明。

推荐平台：Render。

原因：

- 官方支持 Node.js Web Service
- 官方支持持久化磁盘
- 你的文件和 SQLite 数据都可以保存在磁盘里
- 部署后会得到一个公网网址，你在任何电脑都能打开

参考的官方文档：

- [Render Web Services](https://render.com/docs/web-services)
- [Render Persistent Disks](https://render.com/docs/disks)
- [Render Blueprint YAML Reference](https://render.com/docs/blueprint-spec)

## 这次已经准备好的文件

- 云端入口程序：[cme-app.js](/Users/ken/Documents/New%20project/cme-app.js)
- 云端登录页：[views/cme-login.ejs](/Users/ken/Documents/New%20project/views/cme-login.ejs)
- 云端后台页：[views/cme-cloud.ejs](/Users/ken/Documents/New%20project/views/cme-cloud.ejs)
- Render 部署配置：[render.yaml](/Users/ken/Documents/New%20project/render.yaml)

## 部署后的网址结构

- 登录页：`https://你的域名/login`
- 首页：`https://你的域名/`
- 健康检查：`https://你的域名/health`

## 部署步骤

1. 把当前项目上传到 GitHub

2. 注册并登录 Render

3. 在 Render 里选择：
   - `New +`
   - `Blueprint`

4. 连接你的 GitHub 仓库

5. Render 会自动读到 [render.yaml](/Users/ken/Documents/New%20project/render.yaml)

6. 在环境变量页面填两个值：
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`

7. 创建成功后，Render 会给你一个 `onrender.com` 的网址

8. 打开这个网址，进入登录页

## 很关键的一点

Render 官方说明里写得很明确：默认文件系统是临时的，必须给服务挂载 `persistent disk`，否则文件会在重启或重新部署后丢失。

我已经在 [render.yaml](/Users/ken/Documents/New%20project/render.yaml) 里配置了磁盘：

- 挂载路径：`/var/data`
- SQLite 数据目录：`/var/data/app-data`
- 文件保存目录：`/var/data/cme-downloads`

## 你部署后会得到什么

- 一个独立的 CME 文件网站
- 网站自动定时检查并下载文件
- 文件长期保存在云端磁盘
- 你在任何电脑上登录网页后都能下载历史文件

## 这一步你最可能卡住的地方

不是代码，是：

- GitHub 仓库上传
- Render 账号创建
- 第一次点 Blueprint 部署

如果你要，我下一步可以继续直接带你做：

1. 把这个项目整理成适合上传 GitHub 的状态
2. 一步一步教你在 Render 上点哪里
3. 帮你把登录账号密码也一起规划好
