# 🔧 前端启动问题解决方案

## ❌ 问题描述

启动前端时报错：
```
Error: Cannot find module 'D:\vite\bin\vite.js'
'Tools\Tools\new_api_tools\frontend\node_modules\.bin\' 不是内部或外部命令
```

## 🔍 问题原因

这是 Windows 环境下 npm 脚本执行的路径问题：
1. npm 在 Windows PowerShell 中执行 bin 脚本时路径解析有问题
2. `node_modules/.bin/` 下的脚本在某些 Windows 环境中无法正常调用

## ✅ 解决方案

### 方案 1: 直接使用 node 命令（已应用）

修改 `package.json` 中的脚本，直接用 node 运行：

```json
{
  "scripts": {
    "dev": "node node_modules/vite/bin/vite.js --host",
    "build": "node node_modules/typescript/bin/tsc && node node_modules/vite/bin/vite.js build",
    "preview": "node node_modules/vite/bin/vite.js preview",
    "type-check": "node node_modules/typescript/bin/tsc --noEmit"
  }
}
```

### 方案 2: 使用 cross-env

如果方案 1 不行，可以安装 cross-env：

```bash
npm install --save-dev cross-env
```

然后修改脚本：
```json
{
  "scripts": {
    "dev": "cross-env NODE_ENV=development vite --host"
  }
}
```

### 方案 3: 清理并重新安装

如果还是有问题：

```bash
# 清理
Remove-Item -Path node_modules -Recurse -Force
Remove-Item -Path package-lock.json -Force

# 清理 npm 缓存
npm cache clean --force

# 重新安装
npm install

# 启动
npm run dev
```

## 🚀 现在启动

使用以下任一方式启动：

### 方式 1: npm 脚本
```bash
npm run dev
```

### 方式 2: 直接运行
```bash
node node_modules/vite/bin/vite.js --host
```

### 方式 3: 使用启动脚本
```bash
# Windows
start.bat

# Linux/Mac
./start.sh
```

## 🌐 访问地址

启动成功后访问：
- **本地**: http://localhost:3000
- **局域网**: http://你的IP:3000

## 📝 其他常见问题

### 端口被占用

修改 `vite.config.ts`:
```typescript
server: {
  port: 3001,  // 改为其他端口
}
```

### TypeScript 错误

```bash
npm run type-check
```

### 依赖版本冲突

```bash
npm install --legacy-peer-deps
```

## ✅ 验证启动成功

启动后应该看到类似输出：
```
VITE v5.x.x  ready in xxx ms

➜  Local:   http://localhost:3000/
➜  Network: http://192.168.x.x:3000/
```

在浏览器访问 http://localhost:3000 应该能看到 Dashboard 页面。

---

**问题已解决！如有其他问题，请查看其他文档或提交 Issue。** ✨

