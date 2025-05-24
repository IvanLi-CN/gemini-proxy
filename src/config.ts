import minimist from 'minimist';

export enum LogLevel {
  MINIMAL = 'minimal',
  NORMAL = 'normal',
  VERBOSE = 'verbose',
}

const argv = minimist(process.argv.slice(2), {
  alias: {
    p: 'port',
    h: 'host',
    r: 'maxRetries', // 'r' for retries
    i: 'targetIp',   // 'i' for IP
    d: 'targetDomain', // 'd' for domain
    l: 'logLevel' // 'l' for logLevel
  }
});

const getConfig = (envVar: string, argName: string, defaultValue: string | number): { value: string | number, isDefault: boolean } => {
  if (argv[argName] !== undefined) {
    // 命令行参数优先
    return { value: typeof defaultValue === 'number' ? Number(argv[argName]) : String(argv[argName]), isDefault: false };
  }
  if (process.env[envVar] !== undefined) {
    // 环境变量次之
    return { value: typeof defaultValue === 'number' ? Number(process.env[envVar]) : String(process.env[envVar]), isDefault: false };
  }
  return { value: defaultValue, isDefault: true }; // 默认值
};

let targetIpConfig = getConfig('TARGET_IP', 'targetIp', 'example.com');
let targetDomainConfig = getConfig('TARGET_DOMAIN', 'targetDomain', 'example.com');

export let TARGET_IP = targetIpConfig.value as string;
export let TARGET_DOMAIN = targetDomainConfig.value as string;

// 如果其中一个没有设置，则默认使用对方的值
if (targetIpConfig.isDefault && !targetDomainConfig.isDefault) {
  TARGET_IP = TARGET_DOMAIN;
} else if (targetDomainConfig.isDefault && !targetIpConfig.isDefault) {
  TARGET_DOMAIN = TARGET_IP;
}

export const TARGET_PORT = getConfig('TARGET_PORT', 'targetPort', 443).value as number;
export const PORT = getConfig('PORT', 'port', 25055).value as number; // PROXY_PORT 更名为 PORT
export const HOST = getConfig('HOST', 'host', '0.0.0.0').value as string; // 新增 HOST
export const MAX_RETRIES = getConfig('MAX_RETRIES', 'maxRetries', 9).value as number;
export const LOG_LEVEL = getConfig('LOG_LEVEL', 'logLevel', LogLevel.NORMAL).value as LogLevel;

export const MQTT_BROKER_URL_CONFIG = getConfig('MQTT_BROKER_URL', 'mqttBrokerUrl', '');
export const MQTT_USERNAME_CONFIG = getConfig('MQTT_USERNAME', 'mqttUsername', '');
export const MQTT_PASSWORD_CONFIG = getConfig('MQTT_PASSWORD', 'mqttPassword', '');

export const MQTT_BROKER_URL = MQTT_BROKER_URL_CONFIG.value as string;
export const MQTT_USERNAME = MQTT_USERNAME_CONFIG.value as string;
export const MQTT_PASSWORD = MQTT_PASSWORD_CONFIG.value as string;