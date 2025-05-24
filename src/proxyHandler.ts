import http from 'http';
import https from 'https';
import httpProxy from 'http-proxy';
import net from 'net';
import chalk from 'chalk';
import { TARGET_IP, TARGET_DOMAIN, TARGET_PORT, MAX_RETRIES } from './config';
import { log } from './logger';
import { LogLevel } from './config';
import { publishMqtt, dailyRequests, totalRequests, dailySuccessByRetries, totalSuccessByRetries, dailyFailures, totalFailures, MQTT_TOPIC_PREFIX } from './mqttService';

const requestRetryCounts = new Map<http.IncomingMessage, number>();
const requestBodies = new Map<http.IncomingMessage, Buffer>(); // 用于存储请求体

// 构建带 SNI 的 https.Agent
const agent = new https.Agent({
  servername: TARGET_DOMAIN, // 你要伪装的主机名
  rejectUnauthorized: true
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
    requestRetryCounts.delete(req); // 清除当前请求的重试计数
    requestBodies.delete(req); // 清除当前请求的请求体
  } else {
    console.error(chalk.red('代理错误：响应对象不是 http.ServerResponse 类型。'), err);
  }
});

// 监听 proxyReq 事件，用于在代理请求发送前写入请求体
proxy.on('proxyReq', (proxyReq: http.ClientRequest, req: http.IncomingMessage, res: http.ServerResponse, options: httpProxy.ServerOptions) => {
  // 移除所有 x-forwarded 和 x-real 相关的请求头
  const headers = proxyReq.getHeaders(); // 获取所有请求头
  for (const headerName in headers) {
    if (headerName.toLowerCase().startsWith('x-forwarded-') || headerName.toLowerCase().startsWith('x-real-') || headerName.toLowerCase() === 'accept-encoding') {
      proxyReq.removeHeader(headerName); // 使用 removeHeader 方法移除
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

    if (chunkCount === 0 && proxyRes.statusCode === 200) {
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
        // 增加失败统计
        publishMqtt(`${MQTT_TOPIC_PREFIX}daily/failures`, (dailyFailures + 1).toString(), true);
        publishMqtt(`${MQTT_TOPIC_PREFIX}total/failures`, (totalFailures + 1).toString(), true);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end('目标服务器响应体为空且重试失败。');
        }
      }
    } else { // 响应体不为空
      const currentRetry = requestRetryCounts.get(req) || 0;
      // 成功，根据重试次数更新统计
      const currentDailySuccessCount = dailySuccessByRetries.get(currentRetry) || 0;
      const currentTotalSuccessCount = totalSuccessByRetries.get(currentRetry) || 0;
      publishMqtt(`${MQTT_TOPIC_PREFIX}daily/success/${currentRetry}`, (currentDailySuccessCount + 1).toString(), true);
      publishMqtt(`${MQTT_TOPIC_PREFIX}total/success/${currentRetry}`, (currentTotalSuccessCount + 1).toString(), true);
    }
    res.end(); // 结束客户端响应
    log(LogLevel.MINIMAL, `响应流结束，传输了 ${fullResponseBody.length} 字节。`);
    requestRetryCounts.delete(req); // 清除当前请求的重试计数
    requestBodies.delete(req); // 清除当前请求的请求体
  });
});

export const setupProxy = (req: http.IncomingMessage, res: http.ServerResponse) => {
  requestRetryCounts.delete(req); // 清除当前请求的重试计数
  requestBodies.delete(req); // 清除当前请求的请求体

  // 增加总请求数
  publishMqtt(`${MQTT_TOPIC_PREFIX}daily/requests`, (dailyRequests + 1).toString(), true);
  publishMqtt(`${MQTT_TOPIC_PREFIX}total/requests`, (totalRequests + 1).toString(), true);

  // 如果重试次数达到最大限制且仍然失败，则计为失败
  // 在这里判断请求是否最终失败（重试次数达到上限且响应体为空）
  // 这个逻辑应该在 proxyRes.on('end') 中处理，因为只有在那里才能确定最终的成功或失败状态
  // 这里的 currentRetry 是指初始请求的重试次数，而不是最终的重试次数

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
};