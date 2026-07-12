const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// ============ 词库 ============
const WORD_BANK = {
  动物: ['猫', '狗', '大象', '长颈鹿', '熊猫', '兔子', '老虎', '企鹅', '海豚', '蝴蝶', '蜗牛', '鲨鱼', '孔雀', '猴子', '鲸鱼'],
  食物: ['汉堡', '披萨', '冰淇淋', '西瓜', '蛋糕', '饺子', '火锅', '寿司', '苹果', '烤鸭', '巧克力', '棒棒糖', '面条', '汤圆', '粽子'],
  物品: ['手机', '雨伞', '自行车', '相机', '眼镜', '吉他', '足球', '台灯', '闹钟', '行李箱', '望远镜', '耳机', '剪刀', '蜡烛', '钥匙'],
  自然: ['太阳', '月亮', '彩虹', '火山', '闪电', '流星', '瀑布', '沙漠', '雪花', '龙卷风', '向日葵', '仙人掌', '北极光', '珊瑚', '台风'],
  建筑: ['城堡', '灯塔', '金字塔', '长城', '摩天轮', '天安门', '埃菲尔铁塔', '风车', '桥梁', '寺庙', '帐篷', '摩天大楼', '教堂', '水立方', '鸟巢'],
  职业: ['医生', '厨师', '宇航员', '画家', '消防员', '警察', '老师', '科学家', '魔术师', '海盗', '国王', '舞蹈家', '歌手', '水手', '园丁'],
  动作: ['跳舞', '游泳', '跑步', '唱歌', '打篮球', '钓鱼', '骑自行车', '放风筝', '跳绳', '荡秋千', '滑滑梯', '踢足球', '打太极', '冲浪', '滑雪'],
  节日: ['春节', '圣诞', '万圣节', '中秋', '端午', '元宵', '七夕', '龙舟', '烟花', '红包', '月饼', '灯笼', '雪人', '圣诞树', '舞龙'],
};

// ============ 游戏状态管理 ============
const rooms = {};

function createRoom(roomId) {
  return {
    id: roomId,
    players: [],        // { id, name, score, isDrawing, socketId }
    gameStarted: false,
    currentRound: 0,
    totalRounds: 3,
    currentDrawer: null,
    currentWord: '',
    currentCategory: '',
    roundTime: 60,
    timer: null,
    timeLeft: 60,
    wordPool: [],
  };
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildWordPool() {
  const pool = [];
  for (const [category, words] of Object.entries(WORD_BANK)) {
    for (const word of words) {
      pool.push({ category, word });
    }
  }
  return shuffleArray(pool);
}

function getHint(word, revealed) {
  const chars = word.split('');
  const hint = chars.map((c, i) => {
    if (i < revealed) return c;
    return c.match(/[\u4e00-\u9fff]/) ? '⬜' : '_';
  });
  return hint.join(' ');
}

// ============ Socket.IO ============
io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  // 创建房间
  socket.on('create-room', ({ roomId, playerName }) => {
    if (rooms[roomId]) {
      socket.emit('error-msg', '房间已存在，请换个名字或加入已有房间');
      return;
    }
    rooms[roomId] = createRoom(roomId);
    socket.join(roomId);
    rooms[roomId].players.push({
      id: socket.id,
      name: playerName || '匿名玩家',
      score: 0,
      isDrawing: false,
      socketId: socket.id,
    });
    socket.roomId = roomId;
    socket.playerName = playerName || '匿名玩家';
    io.to(roomId).emit('room-update', rooms[roomId]);
    console.log(`[room] ${roomId} created by ${playerName}`);
  });

  // 加入房间
  socket.on('join-room', ({ roomId, playerName }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit('error-msg', '房间不存在');
      return;
    }
    if (room.gameStarted) {
      socket.emit('error-msg', '游戏已开始，请等待下一局');
      return;
    }
    if (room.players.length >= 8) {
      socket.emit('error-msg', '房间已满（最多8人）');
      return;
    }
    socket.join(roomId);
    room.players.push({
      id: socket.id,
      name: playerName || '匿名玩家',
      score: 0,
      isDrawing: false,
      socketId: socket.id,
    });
    socket.roomId = roomId;
    socket.playerName = playerName || '匿名玩家';
    io.to(roomId).emit('room-update', room);
    console.log(`[room] ${playerName} joined ${roomId}`);
  });

  // 开始游戏
  socket.on('start-game', () => {
    const room = rooms[socket.roomId];
    if (!room || room.players.length < 2) {
      socket.emit('error-msg', '至少需要2名玩家');
      return;
    }
    if (room.players[0].id !== socket.id) {
      socket.emit('error-msg', '只有房主可以开始游戏');
      return;
    }

    room.gameStarted = true;
    room.wordPool = buildWordPool();
    room.currentRound = 0;
    room.players.forEach(p => { p.score = 0; p.isDrawing = false; });

    io.to(room.id).emit('game-started', room);
    startRound(room);
  });

  // 设置轮数
  socket.on('set-rounds', ({ rounds }) => {
    const room = rooms[socket.roomId];
    if (!room || room.gameStarted) return;
    if (room.players[0]?.id === socket.id) {
      room.totalRounds = Math.max(1, Math.min(10, rounds));
      io.to(room.id).emit('room-update', room);
    }
  });

  // 设置时间
  socket.on('set-time', ({ seconds }) => {
    const room = rooms[socket.roomId];
    if (!room || room.gameStarted) return;
    if (room.players[0]?.id === socket.id) {
      room.roundTime = Math.max(15, Math.min(180, seconds));
      io.to(room.id).emit('room-update', room);
    }
  });

  // 绘画数据转发
  socket.on('draw', (data) => {
    const room = rooms[socket.roomId];
    if (!room) return;
    if (room.currentDrawer !== socket.id) return;
    socket.to(room.id).emit('draw-data', data);
  });

  // 清空画布
  socket.on('clear-canvas', () => {
    const room = rooms[socket.roomId];
    if (!room || room.currentDrawer !== socket.id) return;
    io.to(room.id).emit('canvas-cleared');
  });

  // 猜词
  socket.on('guess', ({ text }) => {
    const room = rooms[socket.roomId];
    if (!room || !room.gameStarted) return;
    if (room.currentDrawer === socket.id) return; // 画的人不能猜

    const guess = text.trim();
    if (guess === room.currentWord) {
      const player = room.players.find(p => p.id === socket.id);
      if (!player) return;

      // 检查是否已经猜对
      if (player._guessedThisRound) return;

      const timeBonus = Math.floor(room.timeLeft / 10);
      const points = 10 + timeBonus;
      player.score += points;
      player._guessedThisRound = true;

      io.to(room.id).emit('correct-guess', {
        playerName: player.name,
        points,
        word: room.currentWord,
        guesserScores: room.players.map(p => ({ name: p.name, score: p.score })),
      });

      // 所有人猜对 → 提前结束回合
      const allGuessed = room.players
        .filter(p => p.id !== room.currentDrawer)
        .every(p => p._guessedThisRound);
      if (allGuessed) {
        endRound(room);
      }
    } else {
      // 广播猜测消息
      io.to(room.id).emit('chat-message', {
        sender: room.players.find(p => p.id === socket.id)?.name || '???',
        text: guess,
        type: 'guess',
      });
    }
  });

  // 聊天消息（非猜词）
  socket.on('chat', ({ text }) => {
    const room = rooms[socket.roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    io.to(room.id).emit('chat-message', {
      sender: player?.name || '???',
      text,
      type: 'chat',
    });
  });

  // 断开连接
  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`);
    const room = rooms[socket.roomId];
    if (!room) return;

    room.players = room.players.filter(p => p.id !== socket.id);

    if (room.players.length === 0) {
      delete rooms[room.id];
      console.log(`[room] ${room.id} deleted`);
      return;
    }

    // 如果画画的人断开了，结束当前回合
    if (room.currentDrawer === socket.id) {
      clearInterval(room.timer);
      endRound(room);
    }

    io.to(room.id).emit('room-update', room);
  });
});

// ============ 回合管理 ============
function startRound(room) {
  clearInterval(room.timer);

  // 重置猜测状态
  room.players.forEach(p => { p._guessedThisRound = false; p.isDrawing = false; });

  // 选择画家（轮流）
  const drawerIndex = room.currentRound % room.players.length;
  room.currentDrawer = room.players[drawerIndex].id;
  room.players[drawerIndex].isDrawing = true;

  // 选词
  if (room.wordPool.length === 0) {
    room.wordPool = buildWordPool();
  }
  const picked = room.wordPool.pop();
  room.currentWord = picked.word;
  room.currentCategory = picked.category;
  room.currentRound++;
  room.timeLeft = room.roundTime;

  // 通知画家词语
  io.to(room.currentDrawer).emit('your-word', {
    word: room.currentWord,
    category: room.currentCategory,
    round: room.currentRound,
    totalRounds: room.totalRounds,
  });

  // 通知其他人
  io.to(room.id).emit('round-update', {
    round: room.currentRound,
    totalRounds: room.totalRounds,
    drawerName: room.players[drawerIndex].name,
    category: room.currentCategory,
    wordLength: room.currentWord.length,
    timeLeft: room.timeLeft,
    players: room.players.map(p => ({
      name: p.name,
      score: p.score,
      isDrawing: p.isDrawing,
    })),
  });

  // 清空画布
  io.to(room.id).emit('canvas-cleared');

  // 启动计时器
  startTimer(room);
}

function startTimer(room) {
  const interval = setInterval(() => {
    room.timeLeft--;
    io.to(room.id).emit('timer-update', { timeLeft: room.timeLeft });

    // 每10秒给一个提示字
    if (room.timeLeft > 0) {
      const elapsed = room.roundTime - room.timeLeft;
      const hintInterval = Math.max(1, Math.floor(room.roundTime / room.currentWord.length));
      const revealed = Math.floor(elapsed / hintInterval);
      if (revealed > 0 && revealed <= room.currentWord.length) {
        io.to(room.id).emit('word-hint', {
          hint: getHint(room.currentWord, Math.min(revealed, room.currentWord.length)),
        });
      }
    }

    if (room.timeLeft <= 0) {
      clearInterval(interval);
      endRound(room);
    }
  }, 1000);
  room.timer = interval;
}

function endRound(room) {
  clearInterval(room.timer);

  io.to(room.id).emit('round-end', {
    word: room.currentWord,
    players: room.players.map(p => ({ name: p.name, score: p.score })),
  });

  // 延迟后开始下一回合
  setTimeout(() => {
    if (room.currentRound >= room.totalRounds * room.players.length) {
      endGame(room);
    } else {
      startRound(room);
    }
  }, 4000);
}

function endGame(room) {
  room.gameStarted = false;

  // 排名
  const ranked = [...room.players].sort((a, b) => b.score - a.score);

  io.to(room.id).emit('game-end', {
    rankings: ranked.map((p, i) => ({ rank: i + 1, name: p.name, score: p.score })),
  });

  console.log(`[game] ${room.id} ended. Winner: ${ranked[0]?.name}`);
}

// ============ 启动 ============
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎨 你画我猜 服务器已启动: http://localhost:${PORT}`);
});
