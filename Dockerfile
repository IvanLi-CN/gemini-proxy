# 使用 Bun 官方镜像作为基础镜像
FROM oven/bun:latest


# 设置工作目录
WORKDIR /app

# 复制 package.json 和 bun.lock 文件
COPY package.json bun.lock tsconfig.json ./

# 安装依赖
RUN bun install --frozen-lockfile

# 复制源代码
COPY src ./src

# 暴露应用程序运行的端口
EXPOSE 25055

# 定义启动命令
CMD ["bun", "run", "src/index.ts"]