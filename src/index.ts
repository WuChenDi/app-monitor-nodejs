import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { requestId } from 'hono/request-id'
import { HTTPException } from 'hono/http-exception'
import { logger } from 'hono/logger'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import nodeCron from 'node-cron'
import dotenv from 'dotenv'

dotenv.config()

// Constants
const GOOGLE_PLAY_APP_ID = 'com.video.zeroshort'
const APP_STORE_APP_ID = '6741800723'
const STATUS_FILE_PATH = path.join(process.cwd(), 'app_status.json')
const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
const NOTIFICATION_COOLDOWN = 60 * 60 * 1000 // 1 hour in milliseconds

// env
const DINGTALK_WEBHOOK_URL = process.env.DINGTALK_WEBHOOK_URL || ''
const DINGTALK_SECRET = process.env.DINGTALK_SECRET || ''
const PORT = Number.parseInt(process.env.PORT || '3000', 10)
const CHECK_CRON = process.env.CHECK_CRON || '0 */6 * * *' // It is checked by default every 6 hours

interface AppStatus {
  googlePlay: boolean
  appStore: boolean
  lastChecked: number
  lastNotified?: number
}

interface ItunesApiResponse {
  resultCount: number
  results: Array<{
    trackId: number
    trackName: string
    bundleId: string
  }>
}

const LOG_DIR = path.join(process.cwd(), 'logs')

async function ensureLogDir() {
  try {
    await fs.access(LOG_DIR)
  } catch {
    await fs.mkdir(LOG_DIR, { recursive: true })
  }
}

function getCurrentLogFilePath() {
  const currentDate = new Date().toISOString().split('T')[0]
  return path.join(LOG_DIR, `mgcloud-app-monitor-${currentDate}.log`)
}

async function writeLog(message: string, level: 'info' | 'error' | 'warn' = 'info') {
  const timestamp = new Date().toISOString()
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`
  const currentLogFile = getCurrentLogFilePath()

  try {
    await ensureLogDir()

    await fs.appendFile(currentLogFile, logMessage)
    // eslint-disable-next-line no-console
    console.log(logMessage.trim()) // Output to the console simultaneously
  } catch (error) {
    console.error('Error writing to log file:', error)
  }
}

// Initialize Hono app
const app = new Hono()
app.use('*', requestId())

// app.use('*', logger())
app.use(
  logger(async (message) => {
    await writeLog(message)
  })
)

// API endpoints
app.get('/', (c) => {
  return c.json({
    status: 'ok',
    message: 'App Monitor is running',
    endpoints: {
      '/check': 'Manually trigger a check',
      '/status': 'Get current status',
    },
  })
})

app.get('/status', async (c) => {
  try {
    const status = await getAppStatus()
    return c.json(status)
  } catch (error) {
    console.error('Error retrieving app status:', error)
    throw new HTTPException(500, { message: 'Failed to retrieve app status' })
  }
})

app.get('/check', async (c) => {
  try {
    await writeLog('Manual check triggered')
    const status = await checkApps()
    const requestIdValue = c.get('requestId')
    await writeLog(
      `[RequestID: ${requestIdValue}] Check completed, status: ${JSON.stringify(status)}`
    )
    return c.json(status)
  } catch (error) {
    console.error('Failed to check app status:', error)
    if (error instanceof HTTPException) {
      throw error
    }
    throw new HTTPException(500, { message: 'Failed to check app status' })
  }
})

// Helper functions
async function getAppStatus(): Promise<AppStatus> {
  try {
    await ensureStatusFileExists()
    const data = await fs.readFile(STATUS_FILE_PATH, 'utf-8')
    return JSON.parse(data)
  } catch (error) {
    console.error('Error parsing stored app status:', error)
    // Default initial status
    return {
      googlePlay: true,
      appStore: true,
      lastChecked: 0,
    }
  }
}

async function ensureStatusFileExists(): Promise<void> {
  try {
    await fs.access(STATUS_FILE_PATH)
  } catch (error) {
    // File doesn't exist, create it with default values
    const defaultStatus: AppStatus = {
      googlePlay: true,
      appStore: true,
      lastChecked: 0,
    }
    await fs.writeFile(STATUS_FILE_PATH, JSON.stringify(defaultStatus, null, 2))
  }
}

async function saveAppStatus(status: AppStatus): Promise<void> {
  try {
    await fs.writeFile(STATUS_FILE_PATH, JSON.stringify(status, null, 2))
  } catch (error) {
    console.error('Error saving app status:', error)
    throw error
  }
}

async function checkAppExists(url: string): Promise<boolean> {
  await writeLog(`Checking URL: ${url}`)
  try {
    // App Store check
    if (url.includes('apps.apple.com')) {
      return await checkAppStoreStatus()
    }

    // Google Play check
    if (url.includes('play.google.com')) {
      return await checkGooglePlayStatus(url)
    }

    await writeLog(`Unknown app store URL: ${url}`, 'warn')
    return true
  } catch (error) {
    await writeLog(`Error checking app status (${url}): ${error}`, 'error')
    return true
  }
}

async function checkAppStoreStatus(): Promise<boolean> {
  try {
    const apiUrl = `https://itunes.apple.com/lookup?id=${APP_STORE_APP_ID}`
    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': USER_AGENT,
      },
      redirect: 'follow',
    })

    if (!response.ok) {
      throw new Error(`iTunes API error: ${response.status}`)
    }

    const data = (await response.json()) as ItunesApiResponse
    const exists = data.resultCount === 1
    await writeLog(
      `App Store status: ${exists ? 'online' : 'removed'} (ID: ${APP_STORE_APP_ID})`
    )
    return exists
  } catch (error) {
    console.error('Error checking App Store status:', error)
    return true
  }
}

async function checkGooglePlayStatus(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })

    const exists = response.status === 200
    await writeLog(
      `Google Play status: ${exists ? 'online' : 'removed'} (ID: ${GOOGLE_PLAY_APP_ID})`
    )
    return exists
  } catch (error) {
    await writeLog(`Error checking Google Play status: ${error}`, 'error')
    return true
  }
}

async function checkApps(): Promise<AppStatus> {
  await writeLog('Starting app status check')
  const prevStatus = await getAppStatus()
  await writeLog(`Current status: ${JSON.stringify(prevStatus)}`)

  const googlePlayUrl = `https://play.google.com/store/apps/details?id=${GOOGLE_PLAY_APP_ID}`
  const appStoreUrl = `https://apps.apple.com/app/id${APP_STORE_APP_ID}`

  const [googlePlayExists, appStoreExists] = await Promise.all([
    checkAppExists(googlePlayUrl),
    checkAppExists(appStoreUrl),
  ])

  await writeLog(`Google Play status: ${googlePlayExists}`)
  await writeLog(`App Store status: ${appStoreExists}`)

  const newStatus: AppStatus = {
    googlePlay: googlePlayExists,
    appStore: appStoreExists,
    lastChecked: Date.now(),
    lastNotified: prevStatus.lastNotified,
  }

  // Check for status changes - app removed
  const googlePlayRemoved = prevStatus.googlePlay && !googlePlayExists
  const appStoreRemoved = prevStatus.appStore && !appStoreExists

  // Only send notification if there's a status change to offline AND cooldown period has elapsed
  const shouldNotify =
    (googlePlayRemoved || appStoreRemoved) &&
    (!prevStatus.lastNotified ||
      Date.now() - prevStatus.lastNotified > NOTIFICATION_COOLDOWN)

  // Send notification if configured and conditions are met
  if (DINGTALK_WEBHOOK_URL && shouldNotify) {
    try {
      await writeLog('Status change detected, sending notification')
      await sendDingtalkNotification(
        DINGTALK_WEBHOOK_URL,
        {
          googlePlayRemoved,
          appStoreRemoved,
          timestamp: newStatus.lastChecked,
          googlePlayUrl,
          appStoreUrl,
        },
        DINGTALK_SECRET
      )

      await writeLog('Notification sent, updating lastNotified timestamp')
      newStatus.lastNotified = newStatus.lastChecked
    } catch (error) {
      await writeLog(`Failed to send notification: ${error}`)
    }
  } else if (googlePlayRemoved || appStoreRemoved) {
    await writeLog('Status change detected, but notification in cooldown period')
  }

  // Save new status
  await saveAppStatus(newStatus)
  return newStatus
}

async function sendDingtalkNotification(
  webhookUrl: string,
  data: any,
  secret?: string
): Promise<void> {
  let url = webhookUrl

  // Calculate signature if secret is provided
  if (secret) {
    const timestamp = Date.now()
    const stringToSign = `${timestamp}\n${secret}`
    const hmac = crypto.createHmac('sha256', secret)
    hmac.update(stringToSign)
    const sign = hmac.digest('base64')
    const separator = webhookUrl.includes('?') ? '&' : '?'
    url = `${webhookUrl}${separator}timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`
  }

  const payload = {
    msgtype: 'markdown',
    markdown: {
      title: 'App Status Notification',
      text: formatNotificationMessage(data),
    },
  }

  await writeLog(`Sending DingTalk notification, payload: ${JSON.stringify(payload)}`)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error(`DingTalk API error: ${response.status} ${await response.text()}`)
    }

    await writeLog('DingTalk notification sent successfully')
  } catch (error) {
    await writeLog(`Failed to send DingTalk notification: ${error}`)
    throw error
  }
}

function formatNotificationMessage(data: any): string {
  return `## APP应用状态监控通知

### 监控结果

- Google Play - ${GOOGLE_PLAY_APP_ID}
  ${data.googlePlayRemoved ? '⛔ 已下架' : '✅ 正常'}
- App Store - ${APP_STORE_APP_ID}
  ${data.appStoreRemoved ? '⛔ 已下架' : '✅ 正常'}

### 应用链接

- [Google Play 商店](${data.googlePlayUrl})
- [App Store 商店](${data.appStoreUrl})`
}

// Set timed tasks
if (CHECK_CRON) {
  writeLog(`Setting up scheduled check with cron pattern: ${CHECK_CRON}`)
  nodeCron.schedule(CHECK_CRON, async () => {
    await writeLog(`Running scheduled check at ${new Date().toISOString()}`)
    try {
      await checkApps()
    } catch (error) {
      await writeLog(`Error in scheduled check: ${error}`)
    }
  })
}

// Start server
serve(
  {
    fetch: app.fetch,
    port: PORT,
  },
  async (info) => {
    await writeLog(`Server is running on http://localhost:${info.port}`)
    await writeLog(`App Store ID: ${APP_STORE_APP_ID}`)
    await writeLog(`Google Play ID: ${GOOGLE_PLAY_APP_ID}`)
    await writeLog(`DingTalk webhook configured: ${Boolean(DINGTALK_WEBHOOK_URL)}`)

    checkApps().catch(async (error) => {
      await writeLog(`Error in initial check: ${error}`, 'error')
    })
  }
)
