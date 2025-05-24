import http from 'http';
import { PORT, HOST, TARGET_IP, TARGET_PORT, TARGET_DOMAIN } from './config';
import { LogLevel } from './config';
import { initMqttService, closeMqttClient } from './mqttService';
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

// 优雅退出处理
const gracefulShutdown = async () => {
  console.log(chalk.blue('收到终止信号，开始优雅退出...'));

  // 关闭 HTTP 服务器
  await new Promise<void>((resolve) => {
    server.close((err) => {
      if (err) {
        console.error(chalk.red('关闭 HTTP 服务器时发生错误:'), err);
        resolve(); // 即使有错误也继续
      } else {
        console.log(chalk.green('HTTP 服务器已关闭。'));
        resolve();
      }
    });
  });

  // 关闭 MQTT 客户端
  await closeMqttClient();

  console.log(chalk.green('所有服务已关闭，进程退出。'));
  process.exit(0);
};

// 监听终止信号
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);