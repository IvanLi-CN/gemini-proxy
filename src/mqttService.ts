import mqtt from 'mqtt';
import chalk from 'chalk';
import { MQTT_BROKER_URL, MQTT_USERNAME, MQTT_PASSWORD } from './config';
import { log } from './logger';
import { LogLevel } from './config';

let mqttClient: mqtt.MqttClient | null = null;
let dailyResetInterval: NodeJS.Timeout | null = null; // 用于存储 setInterval 的 ID
export const MQTT_TOPIC_PREFIX = 'gemini-proxy/stats/';

export let dailyRequests = 0;
export let dailyRetries = 0;
export let dailySuccess = 0;
export let totalRequests = 0;
export let totalRetries = 0;
export let totalSuccess = 0;

export const publishMqtt = (topic: string, value: string) => {
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
  dailyRetries = 0;
  dailySuccess = 0;
  publishMqtt(`${MQTT_TOPIC_PREFIX}daily/requests`, '0');
  publishMqtt(`${MQTT_TOPIC_PREFIX}daily/retries`, '0');
  publishMqtt(`${MQTT_TOPIC_PREFIX}daily/success`, '0');
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

    scheduleDailyReset(); // 只有在 MQTT 客户端初始化成功后才调度每日重置
  } else {
    console.warn(chalk.yellow('未配置 MQTT_BROKER_URL，将跳过 MQTT 统计。'));
  }
};