import prettyjson from 'prettyjson';
import http from 'http';
import https from 'https'; // 导入 https 模块
import httpProxy from 'http-proxy';
import net from 'net';
import chalk from 'chalk';
import minimist from 'minimist'; // 导入 minimist

enum LogLevel {
  MINIMAL = 'minimal',
  NORMAL = 'normal',
  VERBOSE = 'verbose',
}

const argv = minimist(process.argv.slice(2), {
  alias: {
    p: 'port',
    h: 'host',
    r: 'maxRetries', // 'r' for retries
    i: 'targetIp',   // 'i' for IP
    d: 'targetDomain', // 'd' for domain
    l: 'logLevel' // 'l' for logLevel
  }
});

const getConfig = (envVar: string, argName: string, defaultValue: string | number): { value: string | number, isDefault: boolean } => {
  if (argv[argName] !== undefined) {
    // 命令行参数优先
    return { value: typeof defaultValue === 'number' ? Number(argv[argName]) : String(argv[argName]), isDefault: false };
  }
  if (process.env[envVar] !== undefined) {
    // 环境变量次之
    return { value: typeof defaultValue === 'number' ? Number(process.env[envVar]) : String(process.env[envVar]), isDefault: false };
  }
  return { value: defaultValue, isDefault: true }; // 默认值
};

const log = (level: LogLevel, message: string, data?: any) => {
  const levels = [LogLevel.MINIMAL, LogLevel.NORMAL, LogLevel.VERBOSE];
  const currentLevelIndex = levels.indexOf(LOG_LEVEL);
  const messageLevelIndex = levels.indexOf(level);

  if (messageLevelIndex <= currentLevelIndex) {
    console.log(chalk.blue(`\n--- ${message} ---`));
    if (data) {
      if (data.method) console.log(chalk.green(`方法: ${data.method}`));
      if (data.url) console.log(chalk.green(`URL: ${data.url}`));
      if (data.statusCode) console.log(chalk.magenta(`状态码: ${data.statusCode}`));
      if (data.headers) {
        if (level === LogLevel.NORMAL || level === LogLevel.VERBOSE) {
          console.log(chalk.green(`请求头:`));
          for (const key in data.headers) {
            if (key.toLowerCase() === 'x-goog-api-key') {
              console.log(chalk.cyan(`  ${key}: ${data.headers[key]?.slice(0, 5)}...`));
            } else {
              console.log(chalk.cyan(`  ${key}: ${data.headers[key]}`));
            }
          }
        }
      }
      if (data.responseHeaders) {
        if (level === LogLevel.NORMAL || level === LogLevel.VERBOSE) {
          console.log(chalk.magenta(`响应头:`));
          for (const key in data.responseHeaders) {
            console.log(chalk.yellow(`  ${key}: ${data.responseHeaders[key]}`));
          }
        }
      }
      if (data.requestBody && level === LogLevel.VERBOSE) {
        console.log(chalk.blue(`\n--- 请求体 ---`));
        try {
          const jsonContent = JSON.parse(data.requestBody);
          console.log(prettyjson.render(jsonContent));
        } catch (e) {
          console.log(data.requestBody);
        }
      }
      if (data.responseBody && level === LogLevel.VERBOSE) {
        console.log(chalk.magenta(`响应体:`));
        try {
          const jsonContent = JSON.parse(data.responseBody);
          console.log(prettyjson.render(jsonContent));
        } catch (e) {
          console.log(data.responseBody);
        }
      }
    }
  }
};

let targetIpConfig = getConfig('TARGET_IP', 'targetIp', 'example.com');
let targetDomainConfig = getConfig('TARGET_DOMAIN', 'targetDomain', 'example.com');

let TARGET_IP = targetIpConfig.value as string;
let TARGET_DOMAIN = targetDomainConfig.value as string;

// 如果其中一个没有设置，则默认使用对方的值
if (targetIpConfig.isDefault && !targetDomainConfig.isDefault) {
  TARGET_IP = TARGET_DOMAIN;
} else if (targetDomainConfig.isDefault && !targetIpConfig.isDefault) {
  TARGET_DOMAIN = TARGET_IP;
}

const TARGET_PORT = getConfig('TARGET_PORT', 'targetPort', 443).value as number;
const PORT = getConfig('PORT', 'port', 25055).value as number; // PROXY_PORT 更名为 PORT
const HOST = getConfig('HOST', 'host', '0.0.0.0').value as string; // 新增 HOST
const MAX_RETRIES = getConfig('MAX_RETRIES', 'maxRetries', 9).value as number;
const LOG_LEVEL = getConfig('LOG_LEVEL', 'logLevel', LogLevel.NORMAL).value as LogLevel;
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
  log(LogLevel.NORMAL, '接收到请求', { method: req.method, url: req.url, headers: req.headers });

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
    log(LogLevel.VERBOSE, '请求体', { requestBody: fullRequestBody.toString() });
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
  log(LogLevel.NORMAL, '响应完成', { statusCode: proxyRes.statusCode, responseHeaders: proxyRes.headers });

  let chunkCount = 0;
  let responseBodyBuffer: Buffer[] = [];

  // 手动转发响应头
  if (!res.headersSent) {
    for (const header in proxyRes.headers) {
      res.setHeader(header, proxyRes.headers[header] as string);
    }
    res.writeHead(proxyRes.statusCode || 200);
  }

  // 复制响应流并打印响应体
  proxyRes.on('data', (chunk: Buffer) => {
    responseBodyBuffer.push(chunk);
    chunkCount++;
    res.write(chunk); // 直接将数据块写入客户端响应
  });

  proxyRes.on('end', () => {
    const fullResponseBody = Buffer.concat(responseBodyBuffer);
    log(LogLevel.VERBOSE, '响应体', { responseBody: fullResponseBody.toString() });

    if (chunkCount === 0) {
      const currentRetry = requestRetryCounts.get(req) || 0;
      if (currentRetry < MAX_RETRIES) {
        log(LogLevel.MINIMAL, `响应体为空，尝试重试 ${currentRetry + 1}/${MAX_RETRIES} 次...`);
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
    log(LogLevel.MINIMAL, `响应流结束。`);
  });
});

server.listen(PORT, HOST, () => {
  console.log(chalk.green(`代理服务器正在监听 http://${HOST}:${PORT}，代理到 https://${TARGET_IP}:${TARGET_PORT} (Host: ${TARGET_DOMAIN})`));
});