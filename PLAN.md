# 计划：去除代理相关的请求头

## 目标：
在代理请求发送到目标服务器之前，移除所有以 `x-forwarded-` 或 `x-real-` 开头的请求头。

## 修改文件：
[`src/index.ts`](src/index.ts)

## 修改位置：
在 `proxy.on('proxyReq', ...)` 事件处理函数内部，具体在设置 `Content-Length` 头部之前。

## 修改内容：
我将在 [`src/index.ts`](src/index.ts) 的 `proxy.on('proxyReq', ...)` 函数中添加一个循环，遍历 `proxyReq.headers` 对象。如果请求头的名称（不区分大小写）以 `x-forwarded-` 或 `x-real-` 开头，则将其从 `proxyReq.headers` 中删除。

## 代码修改示意：

```typescript
// 监听 proxyReq 事件，用于在代理请求发送前写入请求体
proxy.on('proxyReq', (proxyReq: http.ClientRequest, req: http.IncomingMessage, res: http.ServerResponse, options: httpProxy.ServerOptions) => {
  // 在这里添加删除请求头的逻辑
  for (const headerName in proxyReq.headers) {
    if (headerName.toLowerCase().startsWith('x-forwarded-') || headerName.toLowerCase().startsWith('x-real-')) {
      delete proxyReq.headers[headerName];
      log(LogLevel.VERBOSE, `已移除代理请求头: ${headerName}`);
    }
  }

  const retryBody = requestBodies.get(req);
  if (retryBody) {
    // 确保设置 Content-Length 头，否则目标服务器可能无法正确解析请求体
    proxyReq.setHeader('Content-Length', Buffer.byteLength(retryBody));
    proxyReq.write(retryBody);
    proxyReq.end();
  }
});
```

## Mermaid 流程图：

```mermaid
graph TD
    A[接收到客户端请求] --> B{是 OPTIONS 请求?};
    B -- 是 --> C[处理 CORS 预检请求并结束];
    B -- 否 --> D[记录请求信息];
    D --> E[读取请求体];
    E --> F[调用 proxy.web 发送代理请求];
    F --> G[proxyReq 事件触发];
    G --> H{遍历 proxyReq.headers};
    H -- 发现 x-forwarded 或 x-real 头 --> I[删除请求头];
    H -- 未发现或已处理 --> J[检查是否有重试请求体];
    J -- 有 --> K[设置 Content-Length 并写入请求体];
    J -- 无 --> L[结束 proxyReq 处理];
    K --> L;
    L --> M[请求发送到目标服务器];
    M --> N[proxyRes 事件触发];
    N --> O[记录响应信息];
    O --> P[手动转发响应头];
    P --> Q[复制响应流并写入客户端响应];
    Q --> R{响应流结束};
    R -- 响应体为空且未达最大重试次数 --> S[增加重试计数并重试];
    R -- 响应体不为空或已达最大重试次数 --> T[结束客户端响应];
    S --> F;
    T --> U[完成];
