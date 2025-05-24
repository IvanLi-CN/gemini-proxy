import mqtt from 'mqtt';
import chalk from 'chalk';
import { MQTT_BROKER_URL, MQTT_USERNAME, MQTT_PASSWORD } from './config';
import { log } from './logger';
import { LogLevel } from './config';

let mqttClient: mqtt.MqttClient | null = null;
let dailyResetInterval: NodeJS.Timeout | null = null; // 用于存储 setInterval 的 ID
export const MQTT_TOPIC_PREFIX = 'gemini-proxy/stats/';

export let dailyRequests = 0;
export let totalRequests = 0;
export const dailySuccessByRetries: Map<number, number> = new Map(); // key: retry count, value: success count
export const totalSuccessByRetries: Map<number, number> = new Map();
export let dailyFailures = 0;
export let totalFailures = 0;

const incrementMapStat = (map: Map<number, number>, key: number) => {
    map.set(key, (map.get(key) || 0) + 1);
};

const setMapStat = (map: Map<number, number>, key: number, value: number) => {
    map.set(key, value);
};

export const publishMqtt = (topic: string, value: string, retain: boolean = false) => {
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

export const resetDailyStats = () => {
  dailyRequests = 0;
  dailySuccessByRetries.clear();
  dailyFailures = 0;
  publishMqtt(`${MQTT_TOPIC_PREFIX}daily/requests`, '0', true);
  // 清空所有 daily/success/{retryCount} 主题
  for (let i = 0; i <= 20; i++) { // 假设最大重试次数为20，需要根据实际配置调整
    publishMqtt(`${MQTT_TOPIC_PREFIX}daily/success/${i}`, '0', true);
  }
  publishMqtt(`${MQTT_TOPIC_PREFIX}daily/failures`, '0', true);
  console.log(chalk.green('每日统计已重置。'));
};

export const scheduleDailyReset = () => {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setDate(now.getDate() + 1);
  nextMidnight.setHours(0, 0, 0, 0); // 设置为下一个午夜 00:00:00.000

  const timeToNextMidnight = nextMidnight.getTime() - now.getTime();
  console.log(chalk.blue(`下一次每日统计重置将在 ${timeToNextMidnight / 1000 / 60 / 60} 小时后进行。`));

  setTimeout(() => {
    resetDailyStats();
    // 每天重复调度，确保只有一个 setInterval 在运行
    if (dailyResetInterval) {
      clearInterval(dailyResetInterval);
    }
    dailyResetInterval = setInterval(resetDailyStats, 24 * 60 * 60 * 1000);
  }, timeToNextMidnight);
};

export const initMqttService = () => {
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
      if (!mqttClient) return; // 确保 mqttClient 不为 null

      // 订阅统计主题以获取保留消息
      const topics = [
        `${MQTT_TOPIC_PREFIX}daily/requests`,
        `${MQTT_TOPIC_PREFIX}total/requests`,
        `${MQTT_TOPIC_PREFIX}daily/failures`,
        `${MQTT_TOPIC_PREFIX}total/failures`,
      ];
      // 动态添加 daily/success/{retryCount} 和 total/success/{retryCount} 主题
      for (let i = 0; i <= 20; i++) { // 假设最大重试次数为20
        topics.push(`${MQTT_TOPIC_PREFIX}daily/success/${i}`);
        topics.push(`${MQTT_TOPIC_PREFIX}total/success/${i}`);
      }

      mqttClient.subscribe(topics, (err) => {
        if (err) {
          console.error(chalk.red('订阅 MQTT 统计主题失败:'), err);
        } else {
          log(LogLevel.VERBOSE, `已订阅 MQTT 统计主题: ${topics.join(', ')}`);
        }
      });
    });

    mqttClient.on('message', (topic, message) => {
      if (!mqttClient) return; // 确保 mqttClient 不为 null
      const value = parseInt(message.toString(), 10);
      if (isNaN(value)) {
        console.warn(chalk.yellow(`收到非数字的 MQTT 统计消息: ${topic} = ${message.toString()}`));
        return;
      }

      switch (topic) {
        case `${MQTT_TOPIC_PREFIX}daily/requests`:
          dailyRequests = value;
          break;
        case `${MQTT_TOPIC_PREFIX}total/requests`:
          totalRequests = value;
          break;
        case `${MQTT_TOPIC_PREFIX}daily/failures`:
          dailyFailures = value;
          break;
        case `${MQTT_TOPIC_PREFIX}total/failures`:
          totalFailures = value;
          break;
        default:
          // 处理 daily/success/{retryCount} 和 total/success/{retryCount}
          const dailySuccessPrefix = `${MQTT_TOPIC_PREFIX}daily/success/`;
          const totalSuccessPrefix = `${MQTT_TOPIC_PREFIX}total/success/`;

          if (topic.startsWith(dailySuccessPrefix)) {
            const retryCountStr = topic.substring(dailySuccessPrefix.length);
            const retryCount = parseInt(retryCountStr, 10);
            if (!isNaN(retryCount)) {
              setMapStat(dailySuccessByRetries, retryCount, value);
            }
          } else if (topic.startsWith(totalSuccessPrefix)) {
            const retryCountStr = topic.substring(totalSuccessPrefix.length);
            const retryCount = parseInt(retryCountStr, 10);
            if (!isNaN(retryCount)) {
              setMapStat(totalSuccessByRetries, retryCount, value);
            }
          } else {
            log(LogLevel.VERBOSE, `收到未知 MQTT 统计主题: ${topic} = ${message.toString()}`);
          }
          break;
      }
      log(LogLevel.VERBOSE, `MQTT 统计数据已更新: ${topic} = ${value}`);
    });

    mqttClient.on('error', (err) => {
      console.error(chalk.red('MQTT 连接错误，请检查 Broker 地址、端口、网络连接或 SSL/TLS 配置:'), err);
    });

    mqttClient.on('offline', () => {
      console.warn(chalk.yellow('MQTT 客户端离线。'));
    });

    mqttClient.on('reconnect', () => {
      console.log(chalk.blue('MQTT 客户端正在重连...'));
    });

    scheduleDailyReset(); // 只有在 MQTT 客户端初始化成功后才调度每日重置
  } else {
    console.warn(chalk.yellow('未配置 MQTT_BROKER_URL，将跳过 MQTT 统计。'));
  }
};

export const closeMqttClient = async () => {
  if (dailyResetInterval) {
    clearInterval(dailyResetInterval);
    dailyResetInterval = null;
    console.log(chalk.green('每日统计重置定时器已清除。'));
  }
  if (mqttClient && mqttClient.connected) {
    await new Promise<void>((resolve) => {
      mqttClient?.end(false, () => { // false 表示不强制关闭，等待消息发送完成
        console.log(chalk.green('MQTT 客户端已断开连接。'));
        resolve();
      });
    });
  } else if (mqttClient) {
    console.log(chalk.yellow('MQTT 客户端未连接或已关闭。'));
  }
};