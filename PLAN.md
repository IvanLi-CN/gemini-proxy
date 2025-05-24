# 日志等级功能实现计划

## 目标
为项目添加日志输出功能，支持精简、普通、详细三个等级，并通过环境变量或命令行参数进行配置。

## 配置
*   **参数名称**: `LOG_LEVEL`
*   **等级值**:
    *   `minimal` (精简): 只显示收到请求、响应完成以及重试等关键内容。
    *   `normal` (普通): 现有日志输出内容。
    *   `verbose` (详细): 带有请求体和响应体。
*   **默认等级**: `normal`

## 详细计划步骤

1.  **定义日志等级和获取配置：**
    *   在 `src/index.ts` 中，在文件顶部定义一个 `LogLevel` 枚举或常量对象，例如：
        ```typescript
        enum LogLevel {
          MINIMAL = 'minimal',
          NORMAL = 'normal',
          VERBOSE = 'verbose',
        }
        ```
    *   使用 `getConfig` 函数获取 `LOG_LEVEL` 的值，并将其存储在一个变量中，例如 `currentLogLevel`。

2.  **创建日志函数：**
    *   创建一个名为 `log` 的函数，它将接受 `level: LogLevel`、`message: string` 和 `data?: any` 作为参数。
    *   该函数将根据 `currentLogLevel` 和传入的 `level` 来决定是否打印消息。
    *   对于 `normal` 模式，将输出请求方法、URL、请求头、响应状态码和响应头。
    *   对于 `verbose` 模式，在 `normal` 模式的基础上，增加请求体和响应体的输出。
    *   错误日志（如 `proxy.on('error')` 中的）将不受此日志等级控制，始终输出。

3.  **替换现有 `console.log` 调用：**

    *   **收到请求 (`server.createServer`)：**
        *   将 `console.log(chalk.blue(`\n--- 接收到请求 ---`));` 替换为 `log(LogLevel.MINIMAL, '收到请求', { method: req.method, url: req.url });`
        *   请求头输出将封装在 `log` 函数内部，根据 `NORMAL` 或 `VERBOSE` 等级决定是否输出。
        *   请求体输出将封装在 `log` 函数内部，根据 `VERBOSE` 等级决定是否输出。

    *   **代理响应 (`proxy.on('proxyRes')`)：**
        *   将 `console.log(chalk.blue(`\n--- 代理响应 ---`));` 替换为 `log(LogLevel.MINIMAL, '响应完成', { statusCode: proxyRes.statusCode });`
        *   响应头输出将封装在 `log` 函数内部，根据 `NORMAL` 或 `VERBOSE` 等级决定是否输出。
        *   响应体输出将封装在 `log` 函数内部，根据 `VERBOSE` 等级决定是否输出。

    *   **重试逻辑 (`proxyRes.on('end')`)：**
        *   将重试相关的 `console.log` 替换为 `log(LogLevel.MINIMAL, ...)`。

    *   **服务器启动信息 (`server.listen`)：**
        *   此处的日志保持不变，因为它属于重要的启动信息，不应受日志等级限制。

## 流程图

```mermaid
graph TD
    A[开始] --> B{定义 LogLevel 枚举};
    B --> C{获取 LOG_LEVEL 配置};
    C --> D{创建 log 函数};
    D --> E{替换 server.createServer 中的日志};
    E --> F{替换 proxy.on('proxyRes') 中的日志};
    F --> G{替换重试逻辑中的日志};
    G --> H{完成};
