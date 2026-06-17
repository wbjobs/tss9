const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

const TOTAL_BIDDERS = 100;
const BIDDER_NAMES = [
  '张', '王', '李', '赵', '刘', '陈', '杨', '黄', '周', '吴',
  '徐', '孙', '朱', '马', '胡', '郭', '何', '高', '林', '罗',
  '郑', '梁', '谢', '宋', '唐', '许', '韩', '冯', '邓', '曹',
  '彭', '曾', '萧', '田', '董', '袁', '潘', '于', '蒋', '蔡',
  '余', '杜', '叶', '程', '苏', '魏', '吕', '丁', '任', '沈',
  '姚', '卢', '傅', '钟', '姜', '崔', '谭', '廖', '范', '汪',
  '陆', '金', '石', '戴', '贾', '韦', '夏', '邱', '方', '侯',
  '邹', '熊', '孟', '秦', '白', '江', '阎', '薛', '尹', '段',
  '雷', '黎', '史', '龙', '贺', '顾', '毛', '郝', '龚', '邵'
];
const BIDDER_TITLES = ['收藏家', '企业家', '艺术商人', '博物馆代表', '私人顾问', '投资者', '贵族后裔', '基金会'];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

class Bidder {
  constructor(id) {
    this.id = id;
    this.name = randomChoice(BIDDER_NAMES) + randomChoice(['先生', '女士', '博士', '阁下']) + '#' + (1000 + id);
    this.title = randomChoice(BIDDER_TITLES);
    this.baseBudget = randomInt(500000, 50000000);
    this.budgetCap = this.baseBudget;
    this.frenzyLevel = Math.random() * 100;
    this.breakthroughChance = this.frenzyLevel / 300;
    this.active = true;
    this.bidCount = 0;
    this.hesitationCount = 0;
    this.currentBid = null;
    this.emotionState = 'calm';
    this.maxBidReached = 0;
  }

  updateEmotion(price, heatIndex) {
    const ratio = price / this.budgetCap;
    if (ratio < 0.3) {
      this.emotionState = 'calm';
    } else if (ratio < 0.6) {
      this.emotionState = 'engaged';
    } else if (ratio < 0.85) {
      this.emotionState = 'anxious';
    } else if (ratio < 1.0) {
      this.emotionState = 'desperate';
    } else {
      this.emotionState = this.active ? 'breakthrough' : 'exited';
    }

    if (ratio >= 0.9 && Math.random() < this.breakthroughChance) {
      const multiplier = 1 + (this.frenzyLevel / 100) * randomInt(10, 50) / 100;
      this.budgetCap = Math.floor(this.baseBudget * multiplier);
      this.emotionState = 'breakthrough';
    }

    if (price > this.budgetCap) {
      if (this.frenzyLevel > 70 && Math.random() < this.breakthroughChance * 0.5) {
        this.budgetCap = Math.floor(this.budgetCap * 1.1);
      } else {
        this.active = false;
        this.emotionState = 'exited';
      }
    }
  }

  shouldBid(price, heatIndex) {
    if (!this.active) return false;
    const ratio = price / this.budgetCap;
    if (ratio >= 1.0) return false;

    let bidProbability = 0.3;
    if (ratio < 0.5) bidProbability = 0.6;
    else if (ratio < 0.8) bidProbability = 0.4;
    else if (ratio < 0.95) bidProbability = 0.15 + (this.frenzyLevel / 100) * 0.3;
    else bidProbability = (this.frenzyLevel / 100) * 0.2;

    bidProbability *= (0.7 + (heatIndex / 100) * 0.6);

    if (ratio > 0.8 && Math.random() < 0.3) {
      this.hesitationCount++;
      return false;
    }

    return Math.random() < bidProbability;
  }

  placeBid(price) {
    const incrementPercent = randomInt(2, 10 + Math.floor(this.frenzyLevel / 10));
    const newBid = Math.floor(price * (1 + incrementPercent / 100));
    this.bidCount++;
    this.currentBid = newBid;
    this.maxBidReached = Math.max(this.maxBidReached, newBid);
    return newBid;
  }

  getExitProbability(price) {
    if (!this.active) return 0;
    const ratio = price / this.budgetCap;
    let prob = 0;
    if (ratio < 0.7) prob = 0.01;
    else if (ratio < 0.85) prob = ratio * 0.1;
    else if (ratio < 0.95) prob = (ratio - 0.7) * 0.8;
    else prob = (ratio - 0.85) * 3;
    prob *= (1 - this.frenzyLevel / 200);
    return Math.min(1, prob);
  }
}

class AuctionHall {
  constructor() {
    this.bidders = [];
    this.currentPrice = 100000;
    this.priceHistory = [];
    this.heatHistory = [];
    this.emotionBreakdownHistory = [];
    this.bidHistory = [];
    this.nextExitCandidate = null;
    this.heatIndex = 0;
    this.lastBidderId = null;
    this.roundCount = 0;
    this.activeBidCount = 0;
    this.initBidders();
    this.timestamp = Date.now();
  }

  initBidders() {
    this.bidders = [];
    for (let i = 0; i < TOTAL_BIDDERS; i++) {
      this.bidders.push(new Bidder(i));
    }
  }

  processNewBid(incomingPrice) {
    this.roundCount++;
    this.currentPrice = incomingPrice;
    this.priceHistory.push({ time: Date.now(), price: incomingPrice });
    if (this.priceHistory.length > 100) this.priceHistory.shift();

    const activeBidders = this.bidders.filter(b => b.active);
    activeBidders.forEach(b => b.updateEmotion(incomingPrice, this.heatIndex));

    let highestBid = incomingPrice;
    let highestBidder = null;
    activeBidders.forEach(bidder => {
      if (bidder.shouldBid(incomingPrice, this.heatIndex)) {
        const bid = bidder.placeBid(incomingPrice);
        if (bid > highestBid) {
          highestBid = bid;
          highestBidder = bidder;
        }
      }
    });

    if (highestBidder) {
      this.lastBidderId = highestBidder.id;
      this.activeBidCount++;
      this.bidHistory.push({
        time: Date.now(),
        bidderId: highestBidder.id,
        bidderName: highestBidder.name,
        bidderTitle: highestBidder.title,
        amount: highestBid,
        emotion: highestBidder.emotionState
      });
      if (this.bidHistory.length > 50) this.bidHistory.shift();
      this.currentPrice = highestBid;
      this.priceHistory[this.priceHistory.length - 1].price = highestBid;
    }

    this.calculateHeatIndex();
    this.predictNextExit();
    this.recordEmotionBreakdown();
    this.heatHistory.push({ time: Date.now(), heat: this.heatIndex });
    if (this.heatHistory.length > 100) this.heatHistory.shift();

    return {
      finalPrice: this.currentPrice,
      highestBidder: highestBidder ? {
        id: highestBidder.id,
        name: highestBidder.name,
        title: highestBidder.title
      } : null
    };
  }

  calculateHeatIndex() {
    const activeCount = this.bidders.filter(b => b.active).length;
    const activeRatio = activeCount / TOTAL_BIDDERS;

    const emotions = this.getEmotionBreakdown();
    const engagementScore = (emotions.engaged * 0.5 + emotions.anxious * 0.8 + emotions.desperate * 1.0 + emotions.breakthrough * 1.2) / TOTAL_BIDDERS * 100;

    const recentBids = this.bidHistory.slice(-5);
    const bidMomentum = recentBids.length >= 3 ? Math.min(100, recentBids.length * 20) : 0;

    const avgFrenzy = this.bidders.reduce((sum, b) => sum + (b.active ? b.frenzyLevel : 0), 0) / Math.max(1, activeCount);

    const priceVelocity = this.calculatePriceVelocity();

    this.heatIndex = Math.min(100, Math.max(0,
      engagementScore * 0.30 +
      bidMomentum * 0.25 +
      avgFrenzy * 0.20 +
      priceVelocity * 0.15 +
      activeRatio * 100 * 0.10
    ));
  }

  calculatePriceVelocity() {
    if (this.priceHistory.length < 5) return 0;
    const recent = this.priceHistory.slice(-5);
    const prices = recent.map(r => r.price);
    let velocity = 0;
    for (let i = 1; i < prices.length; i++) {
      velocity += (prices[i] - prices[i - 1]) / prices[i - 1];
    }
    velocity = (velocity / (prices.length - 1)) * 1000;
    return Math.min(100, Math.max(0, velocity));
  }

  getEmotionBreakdown() {
    const breakdown = { calm: 0, engaged: 0, anxious: 0, desperate: 0, breakthrough: 0, exited: 0 };
    this.bidders.forEach(b => {
      if (breakdown[b.emotionState] !== undefined) breakdown[b.emotionState]++;
    });
    return breakdown;
  }

  recordEmotionBreakdown() {
    const bd = this.getEmotionBreakdown();
    this.emotionBreakdownHistory.push({ time: Date.now(), ...bd });
    if (this.emotionBreakdownHistory.length > 100) this.emotionBreakdownHistory.shift();
  }

  predictNextExit() {
    let maxProb = 0;
    let candidate = null;
    this.bidders.forEach(b => {
      if (b.active) {
        const prob = b.getExitProbability(this.currentPrice);
        if (prob > maxProb) {
          maxProb = prob;
          candidate = b;
        }
      }
    });
    this.nextExitCandidate = candidate ? {
      id: candidate.id,
      name: candidate.name,
      title: candidate.title,
      budgetCap: candidate.budgetCap,
      currentRatio: (this.currentPrice / candidate.budgetCap * 100).toFixed(1),
      exitProbability: (maxProb * 100).toFixed(1)
    } : null;
  }

  getTopBidders(n = 5) {
    return this.bidders
      .filter(b => b.active)
      .sort((a, b) => b.maxBidReached - a.maxBidReached)
      .slice(0, n)
      .map(b => ({
        id: b.id,
        name: b.name,
        title: b.title,
        bidCount: b.bidCount,
        maxBid: b.maxBidReached,
        budgetCap: b.budgetCap,
        frenzy: b.frenzyLevel.toFixed(0),
        emotion: b.emotionState
      }));
  }

  getRadarData() {
    const emotions = this.getEmotionBreakdown();
    const totalActive = this.bidders.filter(b => b.active).length || 1;
    return {
      engagement: ((emotions.engaged + emotions.anxious) / totalActive * 100).toFixed(0),
      anxiety: ((emotions.anxious + emotions.desperate) / totalActive * 100).toFixed(0),
      frenzy: (this.bidders.reduce((s, b) => s + (b.active ? b.frenzyLevel : 0), 0) / totalActive).toFixed(0),
      competitiveness: Math.min(100, this.bidHistory.length * 3).toFixed(0),
      priceMomentum: this.calculatePriceVelocity().toFixed(0),
      participation: (totalActive / TOTAL_BIDDERS * 100).toFixed(0)
    };
  }

  getStatus() {
    return {
      currentPrice: this.currentPrice,
      heatIndex: Math.round(this.heatIndex),
      activeBidders: this.bidders.filter(b => b.active).length,
      totalBidders: TOTAL_BIDDERS,
      roundCount: this.roundCount,
      bidCount: this.activeBidCount,
      emotionBreakdown: this.getEmotionBreakdown(),
      radarData: this.getRadarData(),
      nextExitCandidate: this.nextExitCandidate,
      topBidders: this.getTopBidders(5),
      lastBidder: this.lastBidderId !== null ? {
        id: this.bidders[this.lastBidderId].id,
        name: this.bidders[this.lastBidderId].name,
        title: this.bidders[this.lastBidderId].title,
        emotion: this.bidders[this.lastBidderId].emotionState
      } : null,
      priceHistory: this.priceHistory.slice(-50),
      heatHistory: this.heatHistory.slice(-50),
      emotionBreakdownHistory: this.emotionBreakdownHistory.slice(-50),
      recentBids: this.bidHistory.slice(-10).reverse()
    };
  }
}

const hall = new AuctionHall();

function broadcastStatus() {
  const status = JSON.stringify({ type: 'status', data: hall.getStatus() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(status);
    }
  });
}

setInterval(() => {
  const baseIncrease = hall.currentPrice * (0.02 + Math.random() * 0.05);
  const newBid = Math.floor(hall.currentPrice + baseIncrease);
  hall.processNewBid(newBid);
  broadcastStatus();
}, 5000);

wss.on('connection', (ws) => {
  console.log('新客户端连接');
  ws.send(JSON.stringify({ type: 'status', data: hall.getStatus() }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'manualBid' && data.amount > hall.currentPrice) {
        hall.processNewBid(data.amount);
        broadcastStatus();
      }
      if (data.type === 'reset') {
        Object.assign(hall, new AuctionHall());
        broadcastStatus();
      }
    } catch (e) {
      console.error('消息解析错误:', e);
    }
  });

  ws.on('close', () => {
    console.log('客户端断开连接');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  🎨 艺术品拍卖会情绪分析系统已启动`);
  console.log(`  📍 访问地址: http://localhost:${PORT}`);
  console.log(`  🔌 WebSocket: ws://localhost:${PORT}`);
  console.log(`========================================\n`);
});
