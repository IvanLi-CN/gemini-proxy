import prettyjson from 'prettyjson';
import chalk from 'chalk';
import { LogLevel, LOG_LEVEL } from './config';

export const log = (level: LogLevel, message: string, data?: any) => {
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