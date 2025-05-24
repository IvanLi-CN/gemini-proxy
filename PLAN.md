# 项目计划：Bun + TypeScript 反向代理服务器

**目标：**
创建一个 Bun + TypeScript 项目，实现一个反向代理服务器，将 `http://localhost:25055` 的请求代理到 `https://example.com`，并记录所有请求和响应，处理 CORS，以及进行错误处理。

**核心功能：**

1. **反向代理：** 将传入请求转发到目标 URL。
2. **请求/响应日志：** 记录所有请求和对应的响应数据。
3. **CORS 处理：** 确保跨域请求能够正确处理。
4. **错误处理：** 捕获代理过程中的错误并提供友好的错误响应。

**技术栈：**

* **运行时：** Bun
* **语言：** TypeScript

**详细步骤：**

#### 1. 项目初始化

* **初始化 Bun 项目：** 在当前项目根目录 `/Volumes/ExData/Projects/Ivan/gemini-proxy` 中运行 `bun init` 来初始化 TypeScript 项目（如果尚未初始化）。
* **安装依赖：** 可能会需要安装一些用于日志记录或 HTTP 代理的库，例如 `node-fetch` (如果 Bun 内置的 fetch 不够用) 或其他日志库。

#### 2. HTTP 服务器设置

* **创建入口文件：** 在 `src` 目录下创建 `index.ts` 作为服务器的入口文件。
* **启动 Bun HTTP 服务器：** 使用 Bun 的内置 HTTP 服务器功能，监听 `http://localhost:25055`。

#### 3. 反向代理实现

* **请求转发：**
  * 当接收到来自客户端的请求时，解析请求的 URL、方法、请求头和请求体。
  * 构建一个新的请求，目标 URL 为 `https://example.com` 加上原始请求的路径和查询参数。
  * 将原始请求的请求头（除了可能引起问题的，如 `Host`、`Connection` 等）转发到目标服务器。
  * 将原始请求的请求体转发到目标服务器。
  * 使用 `fetch` 或其他 HTTP 客户端库向目标服务器发起请求。
* **响应转发：**
  * 接收目标服务器的响应。
  * 将目标服务器的响应状态码、响应头（除了可能引起问题的，如 `Content-Encoding`、`Transfer-Encoding` 等）转发回客户端。
  * 将目标服务器的响应体转发回客户端。

#### 4. 请求和响应日志记录与控制台输出

* **控制台彩色输出：**
  * 使用 `chalk` 或 `colors.js` 等库，以美观、带有颜色的方式在控制台输出请求的方法、URL、请求头、请求体。
  * 同样，以彩色方式输出响应的状态码、响应头、响应体。
  * 对于请求体和响应体，需要确保能够正确读取并打印，同时不影响流式传输。
* **日志文件记录（可选）：**
  * 在项目根目录下创建 `logs` 文件夹。
  * 日志文件将按日期命名，例如 `YYYY-MM-DD.log`。
  * 日志内容将包括请求的唯一 ID、时间戳、客户端 IP、请求方法、原始 URL、请求头、请求体、响应状态码、响应头、响应体。
  * 所有日志条目都将是 JSON 格式，方便后续分析。
  * 确保日志写入是非阻塞的，以避免影响代理性能。

#### 5. CORS 处理

* **预检请求 (OPTIONS)：**
  * 当接收到 OPTIONS 请求时，检查 `Origin`、`Access-Control-Request-Method` 和 `Access-Control-Request-Headers`。
  * 根据需要设置 `Access-Control-Allow-Origin`、`Access-Control-Allow-Methods`、`Access-Control-Allow-Headers`、`Access-Control-Max-Age` 等响应头。
  * 直接返回 204 No Content 响应。
* **实际请求：**
  * 对于非 OPTIONS 请求，在代理响应中添加 `Access-Control-Allow-Origin` 等 CORS 相关的响应头，确保浏览器允许跨域访问。

#### 6. 错误处理

* **捕获错误：** 使用 `try-catch` 块捕获代理过程中可能发生的网络错误、上游服务错误等。
* **错误日志：** 将错误信息（包括错误类型、错误消息、堆栈跟踪、相关请求信息）记录到日志文件中。
* **通用错误响应：** 当发生错误时，向客户端返回一个通用的错误响应（例如 500 Internal Server Error），避免暴露内部错误细节。

**代理流程图：**

```mermaid
graph TD
    A[客户端请求] --> B{Bun Proxy Server};
    B -- 监听 http://localhost:25055 --> C{请求处理};
    C -- 记录请求日志 --> D[日志文件 (logs/YYYY-MM-DD.log)];
    C -- 检查是否为 OPTIONS 请求 --> E{CORS 处理};
    E -- 是 --> F[返回 CORS 响应];
    E -- 否 --> G{构建代理请求};
    G -- 转发请求头/体 --> H[目标服务器: https://example.com];
    H -- 响应 --> I{接收目标响应};
    I -- 记录响应日志 --> D;
    I -- 转发响应头/体 --> J{返回客户端响应};
    J --> A;
    C -- 错误发生 --> K{错误处理};
    K -- 记录错误日志 --> D;
    K -- 返回通用错误响应 --> J;
```

#### 7. 确保响应流式传输

* `Bun.serve` 和 `http-proxy` 库通常默认支持流式传输。在实现请求和响应体日志记录时，需要特别注意，确保在不影响流式传输的前提下捕获并打印响应体。这可能涉及到复制响应流。

**项目结构（初步设想）：**

```
.
├── src/
│   ├── index.ts          # 服务器入口文件，包含代理逻辑
│   ├── utils/            # 工具函数，例如日志记录、CORS 处理
│   │   └── logger.ts
│   └── types/            # 类型定义
│       └── index.ts
├── logs/                 # 日志文件存放目录 (可选，如果需要文件日志)
├── package.json
├── bun.lockb
├── tsconfig.json
└── README.md
