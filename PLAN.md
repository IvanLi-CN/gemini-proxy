# MQTT 统计功能实施计划

## 需求总结：

*   **MQTT 客户端库：** 使用 `mqtt` npm 包。
*   **MQTT Broker：** 从环境变量 `MQTT_BROKER_URL` 读取，如果未提供则不发送数据。
*   **MQTT 认证：** 支持通过环境变量 `MQTT_USERNAME` 和 `MQTT_PASSWORD` 进行认证。
*   **MQTT 主题：**
    *   `gemini-proxy/stats/daily/requests`
    *   `gemini-proxy/stats/daily/retries`
    *   `gemini-proxy/stats/daily/success`
    *   `gemini-proxy/stats/total/requests`
    *   `gemini-proxy/stats/total/retries`
    *   `gemini-proxy/stats/total/success`
    *   注意：主题前缀为 `gemini-proxy/`。
*   **数据类型：** 发送累积总数。
*   **每日重置：** 每天午夜 00:00 (系统时区) 重置。

## 架构图：

```mermaid
graph TD
    A[启动应用] --> B{读取 MQTT 配置};
    B -- MQTT_BROKER_URL 存在 --> C[初始化 MQTT 客户端];
    B -- MQTT_BROKER_URL 不存在 --> D[跳过 MQTT 统计];

    C --> E[定义统计变量];
    E --> F[启动 HTTP 代理服务器];

    F --> G{接收到请求};
    G -- MQTT 启用 --> H[增加 dailyRequests, totalRequests];
    H --> I[发布 MQTT 消息: requests];
    I --> J{代理请求};
    G -- MQTT 禁用 --> J;

    J --> K{接收到代理响应};
    K -- 响应体为空 & 未达最大重试次数 & MQTT 启用 --> L[增加 dailyRetries, totalRetries];
    L --> M[发布 MQTT 消息: retries];
    M --> N[重试请求];
    N --> J;
    K -- 响应体为空 & 未达最大重试次数 & MQTT 禁用 --> N;

    K -- 响应体不为空 & 无重试 & MQTT 启用 --> O[增加 dailySuccess, totalSuccess];
    O --> P[发布 MQTT 消息: success];
    P --> Q[结束客户端响应];
    K -- 响应体不为空 & 无重试 & MQTT 禁用 --> Q;

    K -- 响应体为空 & 达到最大重试次数 --> R[错误处理];
    R --> Q;

    subgraph Daily Reset
        S[定时任务: 每天午夜 00:00 (系统时区)] --> T[重置 dailyRequests, dailyRetries, dailySuccess];
        T --> U[发布 MQTT 消息: daily stats (可选, 确保发布 0 或重置后的值)];
    end
```

## 具体实施步骤：

1.  **安装 MQTT 客户端库：**
    *   在 `package.json` 的 `dependencies` 中添加 `"mqtt": "^x.x.x"`。
    *   运行 `bun install` 安装新的依赖。

2.  **修改 `src/index.ts`：**
    *   **导入 `mqtt`：**
        ```typescript
        import mqtt from 'mqtt';
        ```
    *   **MQTT 配置和客户端初始化：**
        ```typescript
        const MQTT_BROKER_URL_CONFIG = getConfig('MQTT_BROKER_URL', 'mqttBrokerUrl', '');
        const MQTT_USERNAME_CONFIG = getConfig('MQTT_USERNAME', 'mqttUsername', '');
        const MQTT_PASSWORD_CONFIG = getConfig('MQTT_PASSWORD', 'mqttPassword', '');

        const MQTT_BROKER_URL = MQTT_BROKER_URL_CONFIG.value as string;
        const MQTT_USERNAME = MQTT_USERNAME_CONFIG.value as string;
        const MQTT_PASSWORD = MQTT_PASSWORD_CONFIG.value as string;

        let mqttClient: mqtt.MqttClient | null = null;
        const MQTT_TOPIC_PREFIX = 'gemini-proxy/stats/';

        if (MQTT_BROKER_URL) {
          const mqttOptions: mqtt.IClientOptions = {
            clean: true, // clean session
            connectTimeout: 4000, // 连接超时
            reconnectPeriod: 1000, // 重连周期
          };

          if (MQTT_USERNAME) {
            mqttOptions.username = MQTT_USERNAME;
          }
          if (MQTT_PASSWORD) {
            mqttOptions.password = MQTT_PASSWORD;
          }

          mqttClient = mqtt.connect(MQTT_BROKER_URL, mqttOptions);

          mqttClient.on('connect', () => {
            console.log(chalk.green('MQTT 客户端已连接到 Broker'));
          });

          mqttClient.on('error', (err) => {
            console.error(chalk.red('MQTT 客户端错误:'), err);
          });

          mqttClient.on('offline', () => {
            console.warn(chalk.yellow('MQTT 客户端离线。'));
          });

          mqttClient.on('reconnect', () => {
            console.log(chalk.blue('MQTT 客户端正在重连...'));
          });
        } else {
          console.warn(chalk.yellow('未配置 MQTT_BROKER_URL，将跳过 MQTT 统计。'));
        }
        ```
    *   **定义统计变量：**
        ```typescript
        let dailyRequests = 0;
        let dailyRetries = 0;
        let dailySuccess = 0;
        let totalRequests = 0;
        let totalRetries = 0;
        let totalSuccess = 0;
        ```
    *   **辅助函数：发布 MQTT 消息**
        ```typescript
        const publishMqtt = (topic: string, value: string) => {
          if (mqttClient && mqttClient.connected) {
            mqttClient.publish(topic, value, (err) => {
              if (err) {
                console.error(chalk.red(`发布 MQTT 消息失败 (${topic}):`), err);
              } else {
                log(LogLevel.VERBOSE, `MQTT 消息已发布: ${topic} = ${value}`);
              }
            });
          }
        };
        ```
    *   **请求统计：** 在 `http.createServer` 的回调函数中，`requestRetryCounts.delete(req);` 之前：
        ```typescript
        server.createServer((req, res) => {
          requestRetryCounts.delete(req); // 清除当前请求的重试计数
          requestBodies.delete(req); // 清除当前请求的请求体

          dailyRequests++;
          totalRequests++;
          publishMqtt(`${MQTT_TOPIC_PREFIX}daily/requests`, dailyRequests.toString());
          publishMqtt(`${MQTT_TOPIC_PREFIX}total/requests`, totalRequests.toString());

          log(LogLevel.NORMAL, '接收到请求', { method: req.method, url: req.url, headers: req.headers });
          // ... 现有 CORS 预检请求处理 ...
        });
        ```
    *   **重试统计：** 在 `proxy.on('proxyRes')` 的 `proxyRes.on('end')` 回调函数中，`if (chunkCount === 0)` 内部，`if (currentRetry < MAX_RETRIES)` 块内：
        ```typescript
        if (chunkCount === 0) {
          const currentRetry = requestRetryCounts.get(req) || 0;
          if (currentRetry < MAX_RETRIES) {
            dailyRetries++;
            totalRetries++;
            publishMqtt(`${MQTT_TOPIC_PREFIX}daily/retries`, dailyRetries.toString());
            publishMqtt(`${MQTT_TOPIC_PREFIX}total/retries`, totalRetries.toString());
            log(LogLevel.MINIMAL, `响应体为空，尝试重试 ${currentRetry + 1}/${MAX_RETRIES} 次...`);
            // ... 现有重试逻辑 ...
          } else {
            console.error(chalk.red(`  响应体为空，已达到最大重试次数 (${MAX_RETRIES})。`));
            if (!res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'text/plain' });
              res.end('目标服务器响应体为空且重试失败。');
            }
          }
        }
        ```
    *   **成功统计：** 在 `proxy.on('proxyRes')` 的 `proxyRes.on('end')` 回调函数中，在 `if (chunkCount === 0)` 外部，但 `res.end()` 之前：
        ```typescript
        if (chunkCount > 0) { // 响应体不为空
            const currentRetry = requestRetryCounts.get(req) || 0;
            if (currentRetry === 0) { // 并且没有重试过
                dailySuccess++;
                totalSuccess++;
                publishMqtt(`${MQTT_TOPIC_PREFIX}daily/success`, dailySuccess.toString());
                publishMqtt(`${MQTT_TOPIC_PREFIX}total/success`, totalSuccess.toString());
            }
        }
        res.end(); // 结束客户端响应
        log(LogLevel.MINIMAL, `响应流结束。`);
        ```
    *   **每日重置机制：** 在 `server.listen` 之前添加：
        ```typescript
        const resetDailyStats = () => {
          dailyRequests = 0;
          dailyRetries = 0;
          dailySuccess = 0;
          publishMqtt(`${MQTT_TOPIC_PREFIX}daily/requests`, '0');
          publishMqtt(`${MQTT_TOPIC_PREFIX}daily/retries`, '0');
          publishMqtt(`${MQTT_TOPIC_PREFIX}daily/success`, '0');
          console.log(chalk.green('每日统计已重置。'));
        };

        // 计算到下一个午夜的毫秒数
        const scheduleDailyReset = () => {
          const now = new Date();
          const nextMidnight = new Date(now);
          nextMidnight.setDate(now.getDate() + 1);
          nextMidnight.setHours(0, 0, 0, 0); // 设置为下一个午夜 00:00:00.000

          const timeToNextMidnight = nextMidnight.getTime() - now.getTime();
          console.log(chalk.blue(`下一次每日统计重置将在 ${timeToNextMidnight / 1000 / 60 / 60} 小时后进行。`));

          setTimeout(() => {
            resetDailyStats();
            // 每天重复调度
            setInterval(resetDailyStats, 24 * 60 * 60 * 1000);
          }, timeToNextMidnight);
        };

        if (mqttClient) { // 只有在 MQTT 客户端初始化成功后才调度每日重置
          scheduleDailyReset();
        }
