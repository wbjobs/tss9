const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${location.host}`;
let ws;
let reconnectAttempts = 0;
let countdownInterval = null;
let countdown = 5;

const formatCNY = (num) => '¥ ' + Number(num).toLocaleString('zh-CN');
const formatTime = (ts) => new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });

function connectWS() {
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('WebSocket 连接成功');
    document.getElementById('connText').textContent = '已连接';
    document.querySelector('.status-dot').classList.add('connected');
    reconnectAttempts = 0;
    startCountdown();
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'status') {
        updateDashboard(msg.data);
        resetCountdown();
      }
    } catch (e) {
      console.error('解析消息失败:', e);
    }
  };

  ws.onclose = () => {
    console.log('WebSocket 断开');
    document.getElementById('connText').textContent = '连接断开，重连中...';
    document.querySelector('.status-dot').classList.remove('connected');
    stopCountdown();
    const delay = Math.min(3000 * (reconnectAttempts + 1), 15000);
    setTimeout(() => {
      reconnectAttempts++;
      connectWS();
    }, delay);
  };

  ws.onerror = (err) => {
    console.error('WebSocket 错误:', err);
  };
}

function startCountdown() {
  stopCountdown();
  countdown = 5;
  updateTimerDisplay();
  countdownInterval = setInterval(() => {
    countdown--;
    if (countdown <= 0) countdown = 5;
    updateTimerDisplay();
  }, 1000);
}

function stopCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);
}

function resetCountdown() {
  countdown = 5;
  updateTimerDisplay();
}

function updateTimerDisplay() {
  document.getElementById('timer').textContent = `下一轮出价: ${countdown}s`;
}

let previousPrice = 100000;

function updateDashboard(data) {
  document.getElementById('currentPrice').textContent = formatCNY(data.currentPrice);
  const priceEl = document.getElementById('priceChange');
  if (data.currentPrice > previousPrice) {
    const pct = ((data.currentPrice - previousPrice) / previousPrice * 100).toFixed(2);
    priceEl.textContent = `+${formatCNY(data.currentPrice - previousPrice)} (${pct}%)`;
    priceEl.className = 'price-change up';
  } else {
    priceEl.textContent = '--';
    priceEl.className = 'price-change';
  }
  previousPrice = data.currentPrice;

  document.getElementById('roundCount').textContent = data.roundCount;
  document.getElementById('bidCount').textContent = data.bidCount;
  document.getElementById('activeBidders').textContent = `${data.activeBidders}/${data.totalBidders}`;

  const lb = document.getElementById('lastBidder').querySelector('.bidder-info');
  if (data.lastBidder) {
    lb.innerHTML = `${data.lastBidder.name} · ${data.lastBidder.title} <span class="emotion-tag tag-${data.lastBidder.emotion}">${data.lastBidder.emotion}</span>`;
  } else {
    lb.textContent = '等待出价...';
  }

  updateHeatGauge(data.heatIndex);
  updateFactorCards(data);
  updateEmotionBars(data.emotionBreakdown, data.totalBidders);
  updateExitCandidate(data.nextExitCandidate);
  updateBayesPrediction(data.bayesPrediction);
  updateBidList(data.recentBids);
  updateBiddersGrid(data.topBidders);
  updateRadarChart(data.radarData);
  updateLineChart(data.priceHistory, data.heatHistory);
  updatePdfChart(data.bayesPrediction, data.currentPrice);
}

function updateHeatGauge(heat) {
  document.getElementById('heatValue').textContent = heat;
  const label = heat < 25 ? '冷场' : heat < 50 ? '温和' : heat < 70 ? '火热' : heat < 85 ? '狂热' : '巅峰对决';
  document.getElementById('heatLabel').textContent = label;

  const maxDash = 251.2;
  const dashOffset = maxDash * (1 - heat / 100);
  document.getElementById('gaugeFill').style.strokeDashoffset = dashOffset;

  const angle = -90 + (heat / 100) * 180;
  document.getElementById('gaugeNeedle').setAttribute('transform', `rotate(${angle} 100 100)`);

  const hue = 120 - (heat * 1.2);
  document.getElementById('heatValue').style.color = `hsl(${hue}, 80%, 60%)`;
}

function updateFactorCards(data) {
  document.getElementById('momentumValue').textContent = data.cumulativeMomentum || 0;
  document.getElementById('scarcityValue').textContent = (data.scarcityFactor || '1.000') + 'x';
  const avg = data.allTimeAvgPrice || 100000;
  document.getElementById('avgPriceValue').textContent = avg >= 10000 ? (avg / 10000).toFixed(1) + '万' : avg;
}

function updateBayesPrediction(pred) {
  if (!pred) {
    document.getElementById('bayesExpected').textContent = '--';
    document.getElementById('bayesMode').textContent = '--';
    document.getElementById('ciLow').textContent = '--';
    document.getElementById('ciHigh').textContent = '--';
    document.getElementById('ciFill').style.width = '0%';
    document.getElementById('ciUncertainty').textContent = '--';
    document.getElementById('peakSharpness').textContent = '峰值尖锐度: --';
    return;
  }

  const fmt = v => v >= 10000 ? (v / 10000).toFixed(1) + '万' : v.toLocaleString('zh-CN');
  document.getElementById('bayesExpected').textContent = '¥ ' + fmt(pred.expectedPrice);
  document.getElementById('bayesMode').textContent = '¥ ' + fmt(pred.modePrice);
  document.getElementById('ciLow').textContent = fmt(pred.ciLow);
  document.getElementById('ciHigh').textContent = fmt(pred.ciHigh);
  document.getElementById('ciUncertainty').textContent = pred.uncertainty + '%';

  const ciWidth = Math.max(10, Math.min(100, 100 - parseFloat(pred.uncertainty)));
  document.getElementById('ciFill').style.width = ciWidth + '%';

  const sharpness = pred.pdfMax ? (pred.pdfMax * 100).toFixed(2) + '%' : '--';
  document.getElementById('peakSharpness').textContent = `峰值尖锐度: ${sharpness}`;
}

function updateEmotionBars(bd, total) {
  const emotions = ['calm', 'engaged', 'anxious', 'desperate', 'breakthrough', 'exited'];
  emotions.forEach(e => {
    const count = bd[e] || 0;
    const pct = (count / total * 100).toFixed(0);
    const bar = document.querySelector(`.${e}-bar`);
    const cnt = document.getElementById(`${e}Count`);
    if (bar) bar.style.width = `${pct}%`;
    if (cnt) cnt.textContent = count;
  });
}

function updateExitCandidate(cand) {
  const card = document.getElementById('exitCard');
  if (!cand) {
    card.innerHTML = '<div class="empty-state-sm">分析中...</div>';
    return;
  }
  card.innerHTML = `
    <div class="exit-name">🆔 #${cand.id} · ${cand.name}</div>
    <div class="exit-title">${cand.title}</div>
    <div class="exit-stats">
      <div class="exit-stat">
        <div class="exit-stat-label">预算上限</div>
        <div class="exit-stat-value" style="font-size:13px">${formatCNY(cand.budgetCap)}</div>
      </div>
      <div class="exit-stat">
        <div class="exit-stat-label">价格占比</div>
        <div class="exit-stat-value">${cand.currentRatio}%</div>
      </div>
    </div>
    <div class="exit-prob-bar">
      <div class="exit-prob-fill" style="width:${cand.exitProbability}%"></div>
    </div>
    <div class="exit-prob-label">
      <span>退出概率</span>
      <span style="color:#f87171;font-weight:700">${cand.exitProbability}%</span>
    </div>
  `;
}

function updateBidList(bids) {
  const list = document.getElementById('bidList');
  if (!bids || bids.length === 0) {
    list.innerHTML = '<div class="empty-state">暂无出价记录</div>';
    return;
  }
  list.innerHTML = bids.map(b => `
    <div class="bid-item ${b.emotion}">
      <div>
        <div class="bid-item-name">${b.bidderName} · ${b.bidderTitle}</div>
        <div style="font-size:10px;color:#6b7280">${formatTime(b.time)}</div>
      </div>
      <div class="bid-item-amount">${formatCNY(b.amount)}</div>
    </div>
  `).join('');
}

function updateBiddersGrid(bidders) {
  const grid = document.getElementById('biddersGrid');
  if (!bidders || bidders.length === 0) {
    grid.innerHTML = '<div class="empty-state">暂无数据</div>';
    return;
  }
  grid.innerHTML = bidders.map((b, i) => {
    const frenzyColor = b.frenzy < 30 ? '#10b981' : b.frenzy < 60 ? '#f59e0b' : b.frenzy < 80 ? '#ef4444' : '#7c3aed';
    return `
      <div class="bidder-card">
        <div class="bidder-rank">${i + 1}</div>
        <div class="bidder-card-name">${b.name}</div>
        <div class="bidder-card-title">#${b.id} · ${b.title}</div>
        <div class="bidder-stats">
          <div class="bs">
            <div class="bs-label">最高出价</div>
            <div class="bs-value">${(b.maxBid / 10000).toFixed(1)}万</div>
          </div>
          <div class="bs">
            <div class="bs-label">出价次数</div>
            <div class="bs-value">${b.bidCount}</div>
          </div>
        </div>
        <div style="font-size:10px;color:#6b7280">狂热指数: ${b.frenzy}</div>
        <div class="bidder-frenzy-bar">
          <div class="bidder-frenzy-fill" style="width:${b.frenzy}%;background:${frenzyColor}"></div>
        </div>
        <div class="bidder-emotion-tag tag-${b.emotion}">${b.emotion}</div>
      </div>
    `;
  }).join('');
}

let radarChart = null;
function updateRadarChart(rd) {
  const ctx = document.getElementById('radarChart').getContext('2d');
  const data = {
    labels: ['参与度', '焦虑度', '狂热值', '竞拍动能', '稀缺性', '在场率'],
    datasets: [{
      label: '当前情绪维度',
      data: [rd.engagement, rd.anxiety, rd.frenzy, rd.momentum, rd.scarcity, rd.participation],
      fill: true,
      backgroundColor: 'rgba(124, 58, 237, 0.3)',
      borderColor: 'rgba(167, 139, 250, 1)',
      pointBackgroundColor: 'rgba(251, 191, 36, 1)',
      pointBorderColor: '#fff',
      pointHoverBackgroundColor: '#fff',
      pointHoverBorderColor: 'rgba(124, 58, 237, 1)',
      borderWidth: 2,
      pointRadius: 4
    }]
  };

  if (!radarChart) {
    radarChart = new Chart(ctx, {
      type: 'radar',
      data: data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 500,
          easing: 'easeOutQuart'
        },
        plugins: {
          legend: { display: false }
        },
        scales: {
          r: {
            beginAtZero: true,
            max: 100,
            ticks: {
              stepSize: 20,
              color: '#6b7280',
              backdropColor: 'transparent'
            },
            grid: { color: 'rgba(255, 255, 255, 0.1)' },
            angleLines: { color: 'rgba(255, 255, 255, 0.1)' },
            pointLabels: {
              color: '#d1d5db',
              font: { size: 12, weight: '600' }
            }
          }
        }
      }
    });
  } else {
    radarChart.data.datasets[0].data = data.datasets[0].data;
    radarChart.update('none');
  }
}

let lineChart = null;
function updateLineChart(priceHist, heatHist) {
  const ctx = document.getElementById('lineChart').getContext('2d');
  const times = priceHist.map(p => formatTime(p.time));
  const prices = priceHist.map(p => p.price);
  const heats = heatHist.map(h => h.heat);

  if (!lineChart) {
    lineChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: times,
        datasets: [
          {
            label: '价格 (¥)',
            data: prices,
            borderColor: '#fbbf24',
            backgroundColor: 'rgba(251, 191, 36, 0.1)',
            yAxisID: 'y',
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 2,
            pointBackgroundColor: '#fbbf24'
          },
          {
            label: '热度指数 (0-100)',
            data: heats,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.05)',
            yAxisID: 'y1',
            fill: false,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 2,
            pointBackgroundColor: '#ef4444',
            borderDash: [5, 5]
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            labels: { color: '#d1d5db' }
          }
        },
        scales: {
          x: {
            ticks: { color: '#6b7280', maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
            grid: { color: 'rgba(255, 255, 255, 0.05)' }
          },
          y: {
            type: 'linear',
            position: 'left',
            ticks: {
              color: '#fbbf24',
              callback: v => (v / 10000).toFixed(0) + '万'
            },
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            title: { display: true, text: '价格', color: '#fbbf24' }
          },
          y1: {
            type: 'linear',
            position: 'right',
            min: 0,
            max: 100,
            ticks: { color: '#ef4444' },
            grid: { drawOnChartArea: false },
            title: { display: true, text: '热度', color: '#ef4444' }
          }
        }
      }
    });
  } else {
    lineChart.data.labels = times;
    lineChart.data.datasets[0].data = prices;
    lineChart.data.datasets[1].data = heats;
    lineChart.update('none');
  }
}

let pdfChart = null;
function updatePdfChart(pred, currentPrice) {
  const ctx = document.getElementById('pdfChart');
  if (!ctx) return;
  const canvasCtx = ctx.getContext('2d');

  if (!pred || !pred.bins || pred.bins.length === 0) {
    if (pdfChart) {
      pdfChart.data.labels = [];
      pdfChart.data.datasets.forEach(ds => ds.data = []);
      pdfChart.update('none');
    }
    return;
  }

  const labels = pred.bins.map(p => p >= 10000 ? (p / 10000).toFixed(1) + '万' : p);
  const pdfData = pred.pdf.map(v => v * 100);

  const ciLowIdx = pred.bins.findIndex(b => b >= pred.ciLow);
  const ciHighIdx = pred.bins.findLastIndex ? pred.bins.findLastIndex(b => b <= pred.ciHigh) : pred.bins.length - 1;

  const bgColors = pred.bins.map((p, i) => {
    if (p < currentPrice) return 'rgba(107, 114, 128, 0.15)';
    if (p < pred.modePrice) {
      const alpha = 0.3 + 0.5 * (i / pred.bins.length);
      return `rgba(59, 130, 246, ${alpha})`;
    } else {
      const alpha = 0.7 - 0.5 * ((i - pred.bins.indexOf(pred.modePrice)) / pred.bins.length);
      return `rgba(236, 72, 153, ${Math.max(0.2, alpha)})`;
    }
  });

  const expectedIdx = pred.bins.reduce((best, p, i) =>
    Math.abs(p - pred.expectedPrice) < Math.abs(pred.bins[best] - pred.expectedPrice) ? i : best, 0);

  const data = {
    labels: labels,
    datasets: [
      {
        label: '概率密度 (%)',
        data: pdfData,
        fill: true,
        backgroundColor: bgColors,
        borderColor: 'rgba(167, 139, 250, 0.9)',
        borderWidth: 2,
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 4
      }
    ]
  };

  if (!pdfChart) {
    pdfChart = new Chart(canvasCtx, {
      type: 'line',
      data: data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 600,
          easing: 'easeOutQuart'
        },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#d1d5db' } },
          tooltip: {
            callbacks: {
              title: (items) => '价格区间: ' + items[0].label,
              label: (item) => '概率密度: ' + item.raw.toFixed(3) + '%'
            }
          },
          annotation: {}
        },
        scales: {
          x: {
            ticks: {
              color: '#9ca3af',
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 10,
              callback: function(val, idx) {
                const allLabels = this.chart.data.labels;
                const realIdx = typeof val === 'number' ? val : idx;
                const label = allLabels[realIdx] || '';
                const bin = pred.bins[realIdx];
                if (bin === pred.modePrice) return '🎯 ' + label;
                if (bin === pred.expectedPrice && realIdx !== pred.bins.indexOf(pred.modePrice)) return '📊 ' + label;
                return label;
              }
            },
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            title: { display: true, text: '可能成交价 (¥)', color: '#60a5fa' }
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: '#f59e0b',
              callback: v => v.toFixed(2) + '%'
            },
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            title: { display: true, text: '概率密度 P(x)', color: '#f59e0b' }
          }
        }
      },
      plugins: [{
        id: 'predictionAnnotations',
        afterDraw(chart) {
          const { ctx, chartArea: { top, bottom }, scales: { x, y } } = chart;
          ctx.save();

          const expectedX = x.getPixelForValue(expectedIdx);
          if (expectedX !== null && !isNaN(expectedX)) {
            ctx.strokeStyle = 'rgba(59, 130, 246, 0.9)';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.moveTo(expectedX, top);
            ctx.lineTo(expectedX, bottom);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#3b82f6';
            ctx.font = 'bold 11px sans-serif';
            ctx.fillText('期望', expectedX + 4, top + 14);
          }

          const modeIdx = pred.bins.indexOf(pred.modePrice);
          if (modeIdx >= 0) {
            const modeX = x.getPixelForValue(modeIdx);
            if (modeX !== null && !isNaN(modeX)) {
              ctx.strokeStyle = 'rgba(236, 72, 153, 0.9)';
              ctx.lineWidth = 2;
              ctx.setLineDash([6, 4]);
              ctx.beginPath();
              ctx.moveTo(modeX, top);
              ctx.lineTo(modeX, bottom);
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.fillStyle = '#ec4899';
              ctx.font = 'bold 11px sans-serif';
              ctx.fillText('众数', modeX + 4, top + 28);
            }
          }

          if (ciLowIdx >= 0 && ciHighIdx >= 0 && ciHighIdx > ciLowIdx) {
            const xLow = x.getPixelForValue(ciLowIdx);
            const xHigh = x.getPixelForValue(ciHighIdx);
            const bandY = bottom - 8;
            ctx.fillStyle = 'rgba(59, 130, 246, 0.25)';
            ctx.fillRect(xLow, bandY - 6, Math.max(1, xHigh - xLow), 10);
            ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
            ctx.lineWidth = 1;
            ctx.strokeRect(xLow, bandY - 6, Math.max(1, xHigh - xLow), 10);
            ctx.fillStyle = '#60a5fa';
            ctx.font = '10px sans-serif';
            ctx.fillText('90% CI', (xLow + xHigh) / 2 - 20, bandY + 18);
          }

          const currIdx = pred.bins.findIndex(b => b >= currentPrice);
          if (currIdx >= 0) {
            const currX = x.getPixelForValue(currIdx);
            if (currX !== null && !isNaN(currX)) {
              ctx.strokeStyle = 'rgba(16, 185, 129, 0.9)';
              ctx.lineWidth = 2;
              ctx.setLineDash([4, 4]);
              ctx.beginPath();
              ctx.moveTo(currX, top);
              ctx.lineTo(currX, bottom);
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.fillStyle = '#10b981';
              ctx.font = 'bold 11px sans-serif';
              ctx.fillText('当前', currX + 4, bottom - 14);
            }
          }

          ctx.restore();
        }
      }]
    });
  } else {
    pdfChart.data.labels = labels;
    pdfChart.data.datasets[0].data = pdfData;
    pdfChart.data.datasets[0].backgroundColor = bgColors;
    pdfChart.update('none');
  }
}

document.getElementById('manualBidBtn').addEventListener('click', () => {
  const input = document.getElementById('manualBidInput');
  const amount = parseInt(input.value);
  if (amount && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'manualBid', amount }));
    input.value = '';
  }
});

document.getElementById('manualBidInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('manualBidBtn').click();
});

document.getElementById('resetBtn').addEventListener('click', () => {
  if (confirm('确定要重置当前拍卖吗？所有数据将被清空。') && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'reset' }));
    previousPrice = 100000;
  }
});

connectWS();
