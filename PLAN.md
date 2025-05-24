# 统计功能升级计划

## 用户需求总结：

*   **目标：** 升级统计功能，以更清晰地了解成功率和具体的分布情况。
*   **现有统计：** `dailyRequests`, `dailyRetries`, `dailySuccess`, `totalRequests`, `totalRetries`, `totalSuccess`。
*   **新统计维度：**
    *   请求总次数
    *   成功次数（按重试次数分类：0次重试成功，1次重试成功，...，r次重试成功）
    *   失败次数（重试机会用尽后）
*   **最大重试次数 (r)：** 用户设置为 20 次，但指出是用户设置的，如果限制上限需要告知用户。这意味着我们需要一个动态的统计变量来存储不同重试次数下的成功。
*   **统计范围：** 每日统计和总统计都需要更新。

## 计划概述：

1.  **修改统计变量定义：**
    *   在 `src/mqttService.ts` 中，将现有的 `dailySuccess` 和 `totalSuccess` 替换为更细粒度的统计结构，例如 `Map<number, number>`，来存储不同重试次数下的成功。
    *   引入 `dailyFailures` 和 `totalFailures` 变量。
    *   `dailyRequests` 和 `totalRequests` 可以保留，因为它们代表总请求数。
    *   `dailyRetries` 和 `totalRetries` 可以移除，因为重试次数将通过成功分类来隐含。

2.  **更新统计发布逻辑：**
    *   在 `src/proxyHandler.ts` 中，修改 `publishMqtt` 的调用，以反映新的统计维度。
    *   当请求成功时，根据 `currentRetry` 的值，更新相应的成功计数（例如：`dailySuccessByRetries[currentRetry]` 和 `totalSuccessByRetries[currentRetry]`）。
    *   当请求失败（重试机会用尽）时，更新 `dailyFailures` 和 `totalFailures`。
    *   更新 `dailyRequests` 和 `totalRequests` 的逻辑。

3.  **更新统计重置逻辑：**
    *   在 `src/mqttService.ts` 的 `resetDailyStats` 函数中，重置新的每日统计变量（`dailyRequests`, `dailySuccessByRetries`, `dailyFailures`）。

4.  **更新 MQTT 订阅和消息处理逻辑：**
    *   在 `src/mqttService.ts` 的 `initMqttService` 中，修改 MQTT 主题订阅列表，以包含新的成功分类主题（例如：`gemini-proxy/stats/daily/success/0`, `gemini-proxy/stats/daily/success/1`, ..., `gemini-proxy/stats/daily/success/r`）和失败主题（`gemini-proxy/stats/daily/failures`, `gemini-proxy/stats/total/failures`）。
    *   在 `mqttClient.on('message')` 回调中，更新 `switch` 语句，以正确解析和更新新的统计变量。对于成功分类，需要从主题中提取重试次数。

5.  **处理最大重试次数：**
    *   由于最大重试次数是用户可配置的，我们需要确保统计结构能够动态适应。使用 `Map<number, number>` 是一个好的选择，因为它 K-V 结构可以存储任意数量的重试次数。
    *   在发布 MQTT 消息时，如果 `currentRetry` 超过了某个阈值（例如，用户设置的 `MAX_RETRIES`），则将其归类为失败。

## 详细计划：

### 阶段 1: 定义新的统计变量和辅助函数

1.  **修改 `src/mqttService.ts`:**
    *   删除现有变量：`dailyRetries`, `dailySuccess`, `totalRetries`, `totalSuccess`。
    *   添加新的统计变量：
        ```typescript
        export let dailyRequests = 0;
        export let totalRequests = 0;
        export const dailySuccessByRetries: Map<number, number> = new Map(); // key: retry count, value: success count
        export const totalSuccessByRetries: Map<number, number> = new Map();
        export let dailyFailures = 0;
        export let totalFailures = 0;
        ```
    *   添加辅助函数来更新 `Map` 类型的统计数据：
        ```typescript
        const incrementMapStat = (map: Map<number, number>, key: number) => {
            map.set(key, (map.get(key) || 0) + 1);
        };

        const setMapStat = (map: Map<number, number>, key: number, value: number) => {
            map.set(key, value);
        };
        ```

### 阶段 2: 更新统计重置逻辑

1.  **修改 `src/mqttService.ts` 中的 `resetDailyStats` 函数:**
    *   重置 `dailyRequests`。
    *   清空 `dailySuccessByRetries`。
    *   重置 `dailyFailures`。
    *   更新 MQTT 发布，发布新的每日统计数据。

### 阶段 3: 更新统计发布逻辑

1.  **修改 `src/proxyHandler.ts`:**
    *   导入新的统计变量：`dailyRequests`, `totalRequests`, `dailySuccessByRetries`, `totalSuccessByRetries`, `dailyFailures`, `totalFailures`。
    *   修改请求成功时的逻辑：
        *   增加 `dailyRequests` 和 `totalRequests`。
        *   根据 `currentRetry` 的值，调用 `publishMqtt` 更新 `dailySuccessByRetries` 和 `totalSuccessByRetries` 对应的 MQTT 主题。
    *   修改请求失败时的逻辑（重试机会用尽）：
        *   增加 `dailyFailures` 和 `totalFailures`。
        *   调用 `publishMqtt` 更新 `dailyFailures` 和 `totalFailures` 对应的 MQTT 主题。
    *   移除对 `dailyRetries`, `totalRetries`, `dailySuccess`, `totalSuccess` 的旧引用。

### 阶段 4: 更新 MQTT 订阅和消息处理逻辑

1.  **修改 `src/mqttService.ts` 中的 `initMqttService` 函数:**
    *   更新 `topics` 数组，以包含新的成功分类主题（例如：`gemini-proxy/stats/daily/success/0`, `gemini-proxy/stats/daily/success/1`, ..., `gemini-proxy/stats/daily/success/r`）和失败主题（`gemini-proxy/stats/daily/failures`, `gemini-proxy/stats/total/failures`）。
    *   在 `mqttClient.on('message')` 回调中，修改 `switch` 语句，以正确解析和更新新的统计变量。对于成功分类，需要从主题中提取重试次数。

### 阶段 5: 考虑 `MAX_RETRIES` 的影响

1.  **在 `src/proxyHandler.ts` 中：**
    *   确保在判断请求是成功还是失败时，正确使用 `MAX_RETRIES`。如果 `currentRetry` 达到或超过 `MAX_RETRIES` 且请求仍未成功，则应将其视为失败。

## Mermaid 图示：

```mermaid
graph TD
    subgraph src/proxyHandler.ts
        PH_A[请求发起] --> PH_B{处理请求};
        PH_B -- 成功 (currentRetry) --> PH_C[更新 dailySuccessByRetries];
        PH_B -- 成功 (currentRetry) --> PH_D[更新 totalSuccessByRetries];
        PH_B -- 失败 (重试用尽) --> PH_E[更新 dailyFailures];
        PH_B -- 失败 (重试用尽) --> PH_F[更新 totalFailures];
        PH_B --> PH_G[更新 dailyRequests];
        PH_B --> PH_H[更新 totalRequests];
        PH_C --> MS_A[publishMqtt: daily/success/{retryCount}];
        PH_D --> MS_B[publishMqtt: total/success/{retryCount}];
        PH_E --> MS_C[publishMqtt: daily/failures];
        PH_F --> MS_D[publishMqtt: total/failures];
        PH_G --> MS_E[publishMqtt: daily/requests];
        PH_H --> MS_F[publishMqtt: total/requests];
    end

    subgraph src/mqttService.ts
        MS_A[接收 MQTT 消息: daily/success/{retryCount}] --> MS_G[更新 dailySuccessByRetries];
        MS_B[接收 MQTT 消息: total/success/{retryCount}] --> MS_H[更新 totalSuccessByRetries];
        MS_C[接收 MQTT 消息: daily/failures] --> MS_I[更新 dailyFailures];
        MS_D[接收 MQTT 消息: total/failures] --> MS_J[更新 totalFailures];
        MS_E[接收 MQTT 消息: daily/requests] --> MS_K[更新 dailyRequests];
        MS_F[接收 MQTT 消息: total/requests] --> MS_L[更新 totalRequests];

        MS_M[scheduleDailyReset] --> MS_N[resetDailyStats];
        MS_N --> MS_O[重置 dailyRequests];
        MS_N --> MS_P[清空 dailySuccessByRetries];
        MS_N --> MS_Q[重置 dailyFailures];
        MS_N --> MS_R[发布重置后的每日统计到 MQTT];
    end
