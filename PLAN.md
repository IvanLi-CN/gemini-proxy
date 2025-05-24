# MQTT 统计数据持久化计划

## 目标
在 MQTT 客户端连接成功后，从 MQTT Broker 读取并初始化统计数据，并确保统计数据在发布时被保留。

## 详细计划

**步骤**:

1.  **修改 `publishMqtt` 函数以支持保留消息**:
    *   在 `src/mqttService.ts` 中，修改 `publishMqtt` 函数，增加一个 `retain` 参数，默认为 `false`。
    *   当发布统计数据时，将 `retain` 参数设置为 `true`。

2.  **在 `initMqttService` 中订阅统计主题并读取保留消息**:
    *   在 `src/mqttService.ts` 的 `mqttClient.on('connect', ...)` 回调中，添加订阅统计主题的逻辑。
    *   订阅的主题将是 `gemini-proxy/stats/daily/requests`、`gemini-proxy/stats/daily/retries`、`gemini-proxy/stats/daily/success`、`gemini-proxy/stats/total/requests`、`gemini-proxy/stats/total/retries`、`gemini-proxy/stats/total/success`。
    *   在 `mqttClient.on('message', ...)` 回调中，解析收到的消息，并更新对应的 `dailyRequests`、`dailyRetries` 等变量。需要注意消息的类型（字符串）转换为数字。

3.  **修改 `resetDailyStats` 函数以发布保留消息**:
    *   在 `src/mqttService.ts` 的 `resetDailyStats` 函数中，当发布 0 值时，确保这些消息也被标记为保留消息。

4.  **更新统计数据时发布保留消息**:
    *   在代码中任何更新 `dailyRequests`、`totalRequests` 等变量的地方，确保在发布这些更新时，也将其作为保留消息发布。这可能涉及到在 `proxyHandler.ts` 或其他相关文件中调用 `publishMqtt` 时，将 `retain` 参数设置为 `true`。

## Mermaid 图示

```mermaid
graph TD
    A[应用启动] --> B{MQTT_BROKER_URL 是否配置?};
    B -- 是 --> C[初始化 MQTT 客户端];
    C --> D[MQTT 客户端连接];
    D -- 连接成功 --> E[订阅统计主题];
    E --> F[接收保留消息];
    F --> G[更新本地统计变量];
    G --> H[调度每日重置];
    H --> I[每日重置];
    I --> J[发布重置后的统计数据 (保留消息)];
    K[统计数据更新] --> L[发布更新后的统计数据 (保留消息)];
    G -- 持续运行 --> K;
    I -- 持续运行 --> I;
    B -- 否 --> M[跳过 MQTT 统计];
