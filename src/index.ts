import http from 'http';
import { PORT, HOST, TARGET_IP, TARGET_PORT, TARGET_DOMAIN } from './config';
import { LogLevel } from './config';
import { initMqttService } from './mqttService';
import { setupProxy } from './proxyHandler';
import chalk from 'chalk';

// 初始化 MQTT 服务
initMqttService();

// 监听代理请求
const server = http.createServer((req, res) => {
  setupProxy(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(chalk.green(`代理服务器正在监听 http://${HOST}:${PORT}，代理到 https://${TARGET_IP}:${TARGET_PORT} (Host: ${TARGET_DOMAIN})`));
});