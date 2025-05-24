import { colorize } from 'json-colorizer';
import http from 'http';
import https from 'https'; // 导入 https 模块
import httpProxy from 'http-proxy';
import net from 'net';
import chalk from 'chalk';

const TARGET_IP = 'example.com'; // 目标 IP
const TARGET_PORT = 443; // 目标端口，HTTPS 默认为 443
const TARGET_DOMAIN = 'example.com'; // 目标域名，用于 Host 头和 SNI
const PROXY_PORT = 25055; // 代理服务器监听端口

const MAX_RETRIES = 9;
const requestRetryCounts = new Map<http.IncomingMessage, number>();
const requestBodies = new Map<http.IncomingMessage, Buffer>(); // 用于存储请求体

// 构建带 SNI 的 https.Agent
const agent = new https.Agent({
  servername: TARGET_DOMAIN, // 你要伪装的主机名
  rejectUnauthorized: false // 生产环境请设置为 true，这里为了方便测试设置为 false
});

const proxy = httpProxy.createProxyServer({
  target: {
    protocol: 'https:',
    host: TARGET_IP,
    port: TARGET_PORT
  },
  agent: agent, // agent 应该直接放在这里
  changeOrigin: true, // changeOrigin 也应该直接放在这里
  secure: false, // 禁用SSL证书验证
  hostRewrite: TARGET_DOMAIN,
  selfHandleResponse: true
});

// 处理代理错误
proxy.on('error', (err: Error, req: http.IncomingMessage, res: http.ServerResponse | net.Socket, target?: any) => {
  console.error(chalk.red('代理错误:'), err);
  if (res instanceof http.ServerResponse) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`代理服务器内部错误: ${err.message}. 请检查目标URL的SSL证书或网络环境。`);
  } else {
    console.error(chalk.red('代理错误：响应对象不是 http.ServerResponse 类型。'), err);
  }
});

// 监听代理请求
const server = http.createServer((req, res) => {
  requestRetryCounts.delete(req); // 清除当前请求的重试计数
  requestBodies.delete(req); // 清除当前请求的请求体
  console.log(chalk.blue(`\n--- 接收到请求 ---`));
  console.log(chalk.green(`方法: ${req.method}`));
  console.log(chalk.green(`URL: ${req.url}`));
  console.log(chalk.green(`请求头:`));
  for (const key in req.headers) {
    if (key.toLowerCase() === 'x-goog-api-key') {
      console.log(chalk.cyan(`  ${key}: ${req.headers[key]?.slice(0, 5)}...`));
    } else {
      console.log(chalk.cyan(`  ${key}: ${req.headers[key]}`));
    }
  }

  // 处理 CORS 预检请求
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  // fork req 的请求体，保存到全局状态中，作为重试的请求体
  let requestBodyBuffer: Buffer[] = [];
  req.on('data', (chunk: Buffer) => {
    requestBodyBuffer.push(chunk);
  });

  req.on('end', () => {
    const fullRequestBody = Buffer.concat(requestBodyBuffer);
    requestBodies.set(req, fullRequestBody);

    // 打印刚刚保存的请求体
    // const content = fullRequestBody.toString();
    // console.log(chalk.blue(`\n--- 保存的请求体 ---`));
    // console.log(content);
  });


  proxy.web(req, res, {
    target: {
      protocol: 'https:',
      host: TARGET_IP,
      port: TARGET_PORT
    },
    headers: {
      host: TARGET_DOMAIN // HTTP Host 头
    },
    agent: agent, // agent 应该直接放在这里
    timeout: 60000,
    changeOrigin: true, // changeOrigin 也应该直接放在这里
    selfHandleResponse: true
  });
});

// 监听 proxyReq 事件，用于在代理请求发送前写入请求体
proxy.on('proxyReq', (proxyReq: http.ClientRequest, req: http.IncomingMessage, res: http.ServerResponse, options: httpProxy.ServerOptions) => {
  const retryBody = requestBodies.get(req);
  if (retryBody) {
    // 确保设置 Content-Length 头，否则目标服务器可能无法正确解析请求体
    proxyReq.setHeader('Content-Length', Buffer.byteLength(retryBody));
    proxyReq.write(retryBody);
    proxyReq.end();
  }
});

// 代理响应事件
proxy.on('proxyRes', (proxyRes: http.IncomingMessage, req: http.IncomingMessage, res: http.ServerResponse) => {
  console.log(chalk.blue(`\n--- 代理响应 ---`));
  console.log(chalk.magenta(`状态码: ${proxyRes.statusCode}`));
  console.log(chalk.magenta(`响应头:`));
  for (const key in proxyRes.headers) {
    console.log(chalk.yellow(`  ${key}: ${proxyRes.headers[key]}`));
  }

  console.log(chalk.magenta(`响应体:`));

  let chunkCount = 0;

  // 手动转发响应头
  if (!res.headersSent) {
    for (const header in proxyRes.headers) {
      res.setHeader(header, proxyRes.headers[header] as string);
    }
    res.writeHead(proxyRes.statusCode || 200);
  }

  // 复制响应流并打印响应体
  proxyRes.on('data', (chunk: Buffer) => {
    // let content = chunk.toString();
    // try {
    //   const jsonContent = JSON.parse(content);
    //   content = colorize(JSON.stringify(jsonContent));
    // } catch (e) {
    //   // Not a JSON, keep as is
    // }

    // console.log(chalk.bgGray(`${chunkCount}`.padStart(3, ' ')), ' ', chalk.cyan(chunk.byteLength), '\t', content);
    console.log(chalk.bgGray(`${chunkCount}`.padStart(3, ' ')), ' ', chalk.cyan(chunk.byteLength));
    chunkCount++;
    res.write(chunk); // 直接将数据块写入客户端响应
  });

  proxyRes.on('end', () => {
    if (chunkCount === 0) {
      const currentRetry = requestRetryCounts.get(req) || 0;
      if (currentRetry < MAX_RETRIES) {
        console.log(chalk.yellow(`  响应体为空，尝试重试 ${currentRetry + 1}/${MAX_RETRIES} 次...`));
        requestRetryCounts.set(req, currentRetry + 1);
        // 重新发起请求，proxy.on('proxyReq') 会处理请求体的写入
        setTimeout(() => {
          proxy.web(req, res, {
            target: {
              protocol: 'https:',
              host: TARGET_IP,
              port: TARGET_PORT
            },
            headers: {
              host: TARGET_DOMAIN // HTTP Host 头
            },
            agent: agent, // agent 应该直接放在这里
            timeout: 60000,
            changeOrigin: true, // changeOrigin 也应该直接放在这里
            selfHandleResponse: true
          });
        }, 1000);
        return;
      } else {
        console.error(chalk.red(`  响应体为空，已达到最大重试次数 (${MAX_RETRIES})。`));
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end('目标服务器响应体为空且重试失败。');
        }
      }
    }
    res.end(); // 结束客户端响应
    console.log(chalk.yellow(`  响应流结束。`));
  });
});

server.listen(PROXY_PORT, () => {
  console.log(chalk.green(`代理服务器正在监听 http://localhost:${PROXY_PORT}，代理到 https://${TARGET_IP}:${TARGET_PORT} (Host: ${TARGET_DOMAIN})`));
});