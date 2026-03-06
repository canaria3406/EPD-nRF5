/**
 * EPD QR Code Sender v2.0
 *
 * 產生 QR Code 並透過 BLE 自動傳送至電子紙顯示。
 * 使用 Puppeteer 自動化 Chrome Web Bluetooth API。
 *
 * 使用方式:
 *   1. 編輯 .env 設定 BLE_DEVICE_NAME、QRCODE_URL、EPD_DRIVER
 *   2. npm install
 *   3. node index.js          ← 自動模式
 *      node index.js --manual ← 手動模式（開啟瀏覽器手動操作）
 */

require('dotenv').config();
const QRCode = require('qrcode');
const sharp = require('sharp');
const http = require('http');
const path = require('path');
const { exec } = require('child_process');

// ─── 設定 ────────────────────────────────────────────────────────────────────

const CONFIG = {
  bleDeviceName: process.env.BLE_DEVICE_NAME || 'NRF_EPD_1234',
  qrcodeUrl: process.env.QRCODE_URL || 'https://google.com',
  epdWidth: parseInt(process.env.EPD_WIDTH, 10) || 400,
  epdHeight: parseInt(process.env.EPD_HEIGHT, 10) || 300,
  epdDriver: process.env.EPD_DRIVER || '03',
  mtuSize: parseInt(process.env.MTU_SIZE, 10) || 20,
  interleavedCount: parseInt(process.env.INTERLEAVED_COUNT, 10) || 50,
};

// 判斷顏色模式
const THREE_COLOR_DRIVERS = ['02', '03', '07', '09', '0b'];
const FOUR_COLOR_DRIVERS = ['05', '0c', '0d'];
const isThreeColor = THREE_COLOR_DRIVERS.includes(CONFIG.epdDriver);
const isFourColor = FOUR_COLOR_DRIVERS.includes(CONFIG.epdDriver);
const isManualMode = process.argv.includes('--manual');

const PORT = 8765;

function log(msg) {
  const now = new Date();
  const time = now.toLocaleTimeString('zh-TW', { hour12: false });
  console.log(`[${time}] ${msg}`);
}

// ─── QR Code 產生與影像處理 ──────────────────────────────────────────────────

async function generateAndProcessQRCode() {
  const { qrcodeUrl, epdWidth, epdHeight } = CONFIG;
  log(`正在產生 QR Code: ${qrcodeUrl}`);

  const qrSize = Math.min(epdWidth, epdHeight);
  const qrPngBuffer = await QRCode.toBuffer(qrcodeUrl, {
    type: 'png',
    width: qrSize,
    margin: 2,
    color: { dark: '#000000', light: '#FFFFFF' },
    errorCorrectionLevel: 'M',
  });

  const resizedBuffer = await sharp(qrPngBuffer)
    .resize(qrSize, qrSize, { fit: 'contain', background: '#FFFFFF' })
    .flatten({ background: '#FFFFFF' })
    .toBuffer();

  const xOffset = Math.floor((epdWidth - qrSize) / 2);
  const yOffset = Math.floor((epdHeight - qrSize) / 2);

  const finalRgba = await sharp({
    create: {
      width: epdWidth, height: epdHeight, channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: resizedBuffer, left: xOffset, top: yOffset }])
    .raw()
    .toBuffer();

  // 儲存預覽圖
  const previewPath = path.join(__dirname, 'qrcode_preview.png');
  await sharp(finalRgba, { raw: { width: epdWidth, height: epdHeight, channels: 4 } })
    .png()
    .toFile(previewPath);
  log(`預覽圖已儲存: ${previewPath}`);

  // 轉換為 1-bit 黑白 packed 資料
  const byteWidth = Math.ceil(epdWidth / 8);
  const packedData = new Uint8Array(byteWidth * epdHeight);
  const threshold = 140;

  for (let y = 0; y < epdHeight; y++) {
    for (let x = 0; x < epdWidth; x++) {
      const index = (y * epdWidth + x) * 4;
      const r = finalRgba[index];
      const g = finalRgba[index + 1];
      const b = finalRgba[index + 2];
      const grayscale = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      const bit = grayscale >= threshold ? 1 : 0;
      const byteIndex = y * byteWidth + Math.floor(x / 8);
      const bitIndex = 7 - (x % 8);
      packedData[byteIndex] |= bit << bitIndex;
    }
  }

  log(`影像資料已準備: ${packedData.length} bytes`);
  return packedData;
}

// ─── HTML 頁面產生 ────────────────────────────────────────────────────────────

function generateHTML(packedDataBase64) {
  const isAutoMode = !isManualMode;
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>EPD QR Code Sender</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', 'Microsoft JhengHei', sans-serif;
      background: #0f0f1a;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .container {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 20px;
      padding: 40px;
      max-width: 520px;
      width: 90%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }
    h1 {
      font-size: 1.6em;
      background: linear-gradient(135deg, #667eea, #764ba2);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      text-align: center;
      margin-bottom: 8px;
    }
    .subtitle {
      text-align: center;
      color: #8888aa;
      font-size: 0.9em;
      margin-bottom: 28px;
    }
    .info-card {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 20px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      font-size: 0.9em;
    }
    .info-label { color: #8888aa; }
    .info-value { color: #c0c0e0; font-family: monospace; }
    .btn {
      display: block;
      width: 100%;
      padding: 16px;
      border: none;
      border-radius: 12px;
      font-size: 1.1em;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      margin-bottom: 16px;
    }
    .btn-primary {
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: white;
    }
    .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(102,126,234,0.4); }
    .btn-primary:disabled {
      opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none;
    }
    .progress-container { display: none; margin-bottom: 20px; }
    .progress-bar-bg {
      height: 8px; background: rgba(255,255,255,0.08); border-radius: 4px; overflow: hidden; margin-bottom: 8px;
    }
    .progress-bar {
      height: 100%; background: linear-gradient(90deg, #667eea, #764ba2);
      border-radius: 4px; width: 0%; transition: width 0.3s ease;
    }
    .progress-text { font-size: 0.85em; color: #8888aa; text-align: center; }
    .log-container {
      background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06);
      border-radius: 12px; padding: 16px; max-height: 300px; overflow-y: auto;
      font-family: 'Consolas', monospace; font-size: 0.8em; line-height: 1.6;
    }
    .log-container::-webkit-scrollbar { width: 6px; }
    .log-container::-webkit-scrollbar-track { background: transparent; }
    .log-container::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
    .log-line { color: #88aacc; }
    .log-line.success { color: #66cc88; }
    .log-line.error { color: #ee6666; }
    .log-line .time { color: #555577; margin-right: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📱 EPD QR Code Sender</h1>
    <p class="subtitle">透過藍芽傳送 QR Code 至電子紙${isAutoMode ? '（自動模式）' : ''}</p>

    <div class="info-card">
      <div class="info-row">
        <span class="info-label">裝置名稱</span>
        <span class="info-value">${CONFIG.bleDeviceName}</span>
      </div>
      <div class="info-row">
        <span class="info-label">QR Code URL</span>
        <span class="info-value" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${CONFIG.qrcodeUrl}</span>
      </div>
      <div class="info-row">
        <span class="info-label">電子紙尺寸</span>
        <span class="info-value">${CONFIG.epdWidth} × ${CONFIG.epdHeight}</span>
      </div>
      <div class="info-row">
        <span class="info-label">驅動 / 顏色</span>
        <span class="info-value">0x${CONFIG.epdDriver} / ${isThreeColor ? '三色' : isFourColor ? '四色' : '黑白'}</span>
      </div>
    </div>

    <button id="sendBtn" class="btn btn-primary" onclick="startSend()">
      🔗 連接藍芽並傳送
    </button>

    <div class="progress-container" id="progressContainer">
      <div class="progress-bar-bg">
        <div class="progress-bar" id="progressBar"></div>
      </div>
      <div class="progress-text" id="progressText">準備中...</div>
    </div>

    <div class="log-container" id="logContainer"></div>
  </div>

<script>
// ── 設定 ──
let MTU_SIZE = ${CONFIG.mtuSize};
const DEFAULT_MTU = ${CONFIG.mtuSize};
const INTERLEAVED_COUNT = ${CONFIG.interleavedCount};
const PACKED_DATA_BASE64 = '${packedDataBase64}';
const IS_THREE_COLOR = ${isThreeColor};
const IS_FOUR_COLOR = ${isFourColor};
const EPD_DRIVER = '${CONFIG.epdDriver}';

const EPD_SERVICE_UUID     = '62750001-d828-918d-fb46-b6c11c675aec';
const EPD_CHAR_UUID        = '62750002-d828-918d-fb46-b6c11c675aec';

const EpdCmd = {
  INIT:      0x01,
  WRITE_IMG: 0x30,
  REFRESH:   0x05,
};

// ── 工具函式 ──

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}

function addLog(msg, cls) {
  const log = document.getElementById('logContainer');
  const now = new Date();
  const time = String(now.getHours()).padStart(2,'0') + ':' +
               String(now.getMinutes()).padStart(2,'0') + ':' +
               String(now.getSeconds()).padStart(2,'0');
  const line = document.createElement('div');
  line.className = 'log-line ' + (cls || '');
  line.innerHTML = '<span class="time">' + time + '</span>' + msg;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function setProgress(pct, text) {
  document.getElementById('progressBar').style.width = pct + '%';
  document.getElementById('progressText').innerText = text;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── BLE 寫入 ──

async function bleWrite(characteristic, cmd, data, withResponse) {
  let payload = [cmd];
  if (data) payload.push(...data);
  const buf = Uint8Array.from(payload);
  if (withResponse) {
    await characteristic.writeValueWithResponse(buf);
  } else {
    await characteristic.writeValueWithoutResponse(buf);
  }
}

/**
 * 傳送影像資料 (同 html/js/main.js 的 writeImage 邏輯)
 * @param {string} step - 'bw' 或 'red'
 */
async function writeImage(characteristic, data, step) {
  const chunkSize = MTU_SIZE - 2;
  const totalChunks = Math.ceil(data.length / chunkSize);
  let noReplyCount = INTERLEAVED_COUNT;
  const startTime = Date.now();
  const stepLabel = step === 'bw' ? '黑白' : '顏色';

  for (let i = 0, idx = 0; i < data.length; i += chunkSize, idx++) {
    // flag byte: 同 html/js/main.js writeImage 邏輯
    // step='bw' → low nibble 0x0F, step='red' → low nibble 0x00
    // 第一塊 → high nibble 0x00, 後續 → high nibble 0xF0
    const flag = (step === 'bw' ? 0x0F : 0x00) | (i === 0 ? 0x00 : 0xF0);
    const chunk = Array.from(data.slice(i, i + chunkSize));
    const payload = [flag, ...chunk];

    if (noReplyCount > 0) {
      await bleWrite(characteristic, EpdCmd.WRITE_IMG, payload, false);
      noReplyCount--;
    } else {
      await bleWrite(characteristic, EpdCmd.WRITE_IMG, payload, true);
      noReplyCount = INTERLEAVED_COUNT;
    }

    const pct = Math.round(((idx + 1) / totalChunks) * 100);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    setProgress(pct, stepLabel + ' chunk ' + (idx+1) + '/' + totalChunks + '  (' + elapsed + 's)');

    if (idx % 50 === 0 || idx === totalChunks - 1) {
      addLog(stepLabel + '層: chunk ' + (idx+1) + '/' + totalChunks + ', 耗時: ' + elapsed + 's');
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  addLog(stepLabel + '層傳送完成！共 ' + totalChunks + ' 個 chunks, 耗時: ' + totalTime + 's', 'success');
}

// ── MTU 協商 ──

function waitForMTU(characteristic, timeoutMs) {
  return new Promise((resolve) => {
    const textDecoder = new TextDecoder();
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        addLog('MTU 協商逾時，使用預設值: ' + MTU_SIZE);
        resolve(MTU_SIZE);
      }
    }, timeoutMs);

    characteristic.addEventListener('characteristicvaluechanged', (event) => {
      const data = new Uint8Array(event.target.value.buffer,
        event.target.value.byteOffset, event.target.value.byteLength);
      const msg = textDecoder.decode(data);
      addLog('收到通知: ' + msg);

      if (msg.startsWith('mtu=') && msg.length > 4) {
        const newMtu = parseInt(msg.substring(4));
        if (newMtu > 0 && !resolved) {
          MTU_SIZE = newMtu;
          addLog('✅ MTU 已更新: ' + MTU_SIZE + ' (chunk size: ' + (MTU_SIZE - 2) + ' bytes)', 'success');
          resolved = true;
          clearTimeout(timer);
          resolve(MTU_SIZE);
        }
      }
    });
  });
}

// ── 主流程 ──

async function startSend() {
  const btn = document.getElementById('sendBtn');
  const progressContainer = document.getElementById('progressContainer');

  btn.disabled = true;
  btn.innerText = '連接中...';

  try {
    // 1. 連接 BLE
    addLog('正在請求藍芽裝置...');
    const device = await navigator.bluetooth.requestDevice({
      optionalServices: [EPD_SERVICE_UUID],
      acceptAllDevices: true,
    });
    addLog('已選擇裝置: ' + (device.name || 'unknown'));

    addLog('正在連接 GATT Server...');
    const server = await device.gatt.connect();
    addLog('已連接 GATT Server', 'success');

    const service = await server.getPrimaryService(EPD_SERVICE_UUID);
    addLog('找到 EPD Service');

    const characteristic = await service.getCharacteristic(EPD_CHAR_UUID);
    addLog('找到 EPD Characteristic');

    // 2. 啟用通知 + 等待 MTU 協商
    let mtuPromise;
    try {
      await characteristic.startNotifications();
      addLog('已啟用通知，等待 MTU 協商...');
      mtuPromise = waitForMTU(characteristic, 5000);
    } catch(e) {
      addLog('通知啟用失敗: ' + e.message);
      mtuPromise = Promise.resolve(DEFAULT_MTU);
    }

    // 3. INIT (觸發裝置回傳 mtu=XX)
    btn.innerText = '協商 MTU...';
    addLog('發送 INIT 命令...');
    await bleWrite(characteristic, EpdCmd.INIT, null, true);

    // 等待 MTU 回覆
    await mtuPromise;
    await sleep(300);

    // 4. 傳送影像
    btn.innerText = '傳送中...';
    progressContainer.style.display = 'block';
    const packedData = base64ToUint8Array(PACKED_DATA_BASE64);
    addLog('開始傳送影像 (' + packedData.length + ' bytes, MTU=' + MTU_SIZE + ')...');

    const totalStartTime = Date.now();

    // 黑白層
    await writeImage(characteristic, packedData, 'bw');

    // 三色屏：傳送全白的紅色層（避免紅色雜訊）
    if (IS_THREE_COLOR) {
      addLog('三色屏：傳送空白紅色層...');
      const emptyRedData = new Uint8Array(packedData.length).fill(0xFF);
      await writeImage(characteristic, emptyRedData, 'red');
    }

    // 5. REFRESH
    addLog('發送 REFRESH 命令...');
    await bleWrite(characteristic, EpdCmd.REFRESH, null, true);

    const totalTime = ((Date.now() - totalStartTime) / 1000).toFixed(1);
    setProgress(100, '完成！總耗時: ' + totalTime + 's');
    addLog('✅ 完成！總耗時: ' + totalTime + 's，電子紙正在刷新中。', 'success');

    // 標記完成（供 Puppeteer 檢測）
    document.title = 'EPD_SEND_COMPLETE';
    btn.innerText = '✅ 傳送完成';

    // 6. 斷開
    await sleep(2000);
    device.gatt.disconnect();
    addLog('已斷開藍芽連接');

  } catch (err) {
    addLog('❌ 錯誤: ' + err.message, 'error');
    document.title = 'EPD_SEND_ERROR';
    btn.disabled = false;
    btn.innerText = '🔗 重新連接並傳送';
  }
}

addLog('頁面已載入，QR Code 影像資料已準備就緒');
addLog('顏色模式: ' + (IS_THREE_COLOR ? '三色 (黑白紅)' : IS_FOUR_COLOR ? '四色' : '黑白'));
addLog('點擊上方按鈕以連接藍芽裝置並傳送 QR Code');
</script>
</body>
</html>`;
}

// ─── Puppeteer 自動化模式 ─────────────────────────────────────────────────────

async function runAutomated(html) {
  const puppeteer = require('puppeteer');

  log('正在啟動 Chrome (Puppeteer)...');

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--enable-features=WebBluetooth',
      '--enable-web-bluetooth',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 600, height: 800 });

  // 啟用 CDP DeviceAccess 以自動選擇 BLE 裝置
  const client = await page.createCDPSession();
  await client.send('DeviceAccess.enable');

  const targetName = CONFIG.bleDeviceName;
  let deviceSelected = false;

  client.on('DeviceAccess.deviceRequestPrompted', async (event) => {
    const { id, devices } = event;
    log(`藍芽裝置選擇器已打開，共 ${devices.length} 個裝置`);

    for (const d of devices) {
      log(`  - ${d.name} (${d.id})`);
    }

    const target = devices.find(d => d.name === targetName);
    if (target) {
      log(`自動選擇裝置: ${target.name}`);
      try {
        await client.send('DeviceAccess.selectPrompt', {
          id,
          deviceId: target.id,
        });
        deviceSelected = true;
      } catch (e) {
        log(`選擇裝置失敗: ${e.message}`);
      }
    } else {
      log(`未找到目標裝置 "${targetName}"，等待更多裝置...`);
      // 裝置可能尚未出現，等待後續事件
    }
  });

  // 載入 HTML 頁面（data URL 或 inline）
  // 使用 data URL 方式，Web Bluetooth 需要 secure context，localhost 也可以
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  await new Promise((resolve) => server.listen(PORT, resolve));
  log(`HTTP 伺服器已啟動: http://localhost:${PORT}`);

  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });
  log('頁面已載入');

  // 自動點擊發送按鈕
  await sleep(500);
  log('自動觸發「連接藍芽並傳送」...');
  await page.click('#sendBtn');

  // 等待完成（監聽 document.title 變化）
  log('等待傳送完成...');
  try {
    await page.waitForFunction(
      () => document.title === 'EPD_SEND_COMPLETE' || document.title === 'EPD_SEND_ERROR',
      { timeout: 300000 } // 5 分鐘逾時
    );

    const title = await page.title();
    if (title === 'EPD_SEND_COMPLETE') {
      log('✅ 傳送成功完成！');
    } else {
      log('❌ 傳送過程中發生錯誤');
    }
  } catch (e) {
    log(`等待逾時: ${e.message}`);
  }

  // 清理
  await sleep(2000);
  await browser.close();
  server.close();
  log('已關閉 Chrome 與伺服器');
}

// ─── 手動模式 ─────────────────────────────────────────────────────────────────

async function runManual(html) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  server.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    log(`HTTP 伺服器已啟動: ${url}`);
    log('正在開啟瀏覽器...');

    const chromeCmd = `start chrome "${url}"`;
    exec(chromeCmd, (err) => {
      if (err) {
        exec(`start msedge "${url}"`, (err2) => {
          if (err2) log('無法自動開啟瀏覽器，請手動開啟: ' + url);
        });
      }
    });

    console.log('');
    log('📌 請在瀏覽器中點擊「連接藍芽並傳送」按鈕');
    log('📌 完成傳送後，按 Ctrl+C 關閉伺服器');
  });
}

// ─── 主程式 ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║     EPD QR Code Sender v2.0          ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');

  log(`模式: ${isManualMode ? '手動' : '自動 (Puppeteer)'}`);
  log(`裝置名稱: ${CONFIG.bleDeviceName}`);
  log(`QR Code URL: ${CONFIG.qrcodeUrl}`);
  log(`電子紙尺寸: ${CONFIG.epdWidth}x${CONFIG.epdHeight}`);
  log(`驅動: 0x${CONFIG.epdDriver} (${isThreeColor ? '三色' : isFourColor ? '四色' : '黑白'})`);
  log(`預設 MTU: ${CONFIG.mtuSize} (連接後自動協商)`);
  console.log('');

  // 1. 產生 QR Code 並處理影像
  const packedData = await generateAndProcessQRCode();
  const packedDataBase64 = Buffer.from(packedData).toString('base64');

  // 2. 產生 HTML
  const html = generateHTML(packedDataBase64);

  // 3. 執行
  if (isManualMode) {
    await runManual(html);
  } else {
    await runAutomated(html);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('未處理的錯誤:', err);
  process.exit(1);
});
