# 📱 App Monitor Service

App Monitor is a service designed to monitor the status of applications on Google Play and the App Store. It periodically checks the status of specified applications in the app stores, and when an app is removed, it sends a notification via DingTalk robot.

## ✨ Key Features

1. **App Status Monitoring**

   * Monitors the status of apps on Google Play and the App Store
   * Periodically checks app status (default: every 6 hours)

2. **Notification System**

   * Integrates DingTalk robot to send notifications
   * Supports DingTalk robot signature verification
   * Prevents notification flooding with a 1-hour cooldown

3. **Logging**

   * Automatically creates a log directory and generates log files by date
   * Logs are output to both the console and files

## 🚀 Getting Started

First, set up your `.env` file by copying the example:

```bash
cd app-monitor-nodejs
cp .env.example .env
```

Then, run the development server:

**Recommended versions:**

* Node.js ^v22.10.0
* pnpm ^9.15.4

```bash
pnpm install

pnpm run dev
```

## 🛠️ API Endpoints

1. **Health Check Endpoint**

   ```bash
   GET /
   ```

   Returns the service status and a list of available endpoints.

2. **Status Query Endpoint**

   ```bash
   GET /status
   ```

   Retrieves the current monitored app's status.

3. **Manual Check Endpoint**

   ```bash
   GET /check
   ```

   Manually triggers a check for the app status.

## ⚙️ Environment Variables

Key environment variables:

* `PORT`: Service port (default: 3000)
* `CHECK_CRON`: Check frequency, cron expression (default: every 6 hours)
* `DINGTALK_WEBHOOK_URL`: DingTalk robot webhook URL
* `DINGTALK_SECRET`: DingTalk robot secret key

## Deployment Instructions 🚀

The project supports Docker for deployment. Follow these steps to deploy:

1. **Build the Docker image** 🐳

   ```bash
   docker build -t app-monitor .
   ```

2. **Run the Docker container** 🚢

   ```bash
   docker run -d \
     -p 3000:3000 \
     -v /path/to/logs:/app/logs \
     app-monitor
   ```

## ⚠️ Notes

1. Ensure that you have correctly configured the DingTalk robot webhook and secret key.
2. Log files will be automatically created by date in the `/logs` directory.
3. App status information will be saved in the `app_status.json` file.
4. Docker deployment is recommended for easy and quick startup.

## 📜 License

[MIT](./LICENSE) License © 2025-PRESENT [wudi](https://github.com/WuChenDi)
