const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6, pingTimeout: 60000 });

app.use(express.static(path.join(__dirname, 'public')));

// ===================== DeepSeek API =====================
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-chat';

async function callDeepSeek(messages, apiKey, maxTokens = 600) {
  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      temperature: 0.9,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error('DeepSeek API error ' + res.status + ': ' + err);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

async function generateAIQuestion(apiKey) {
  const prompt = `你是一个情侣默契挑战的出题助手。请生成一道有趣的情侣默契题目。

要求：
- 随机选择题目类型：选择题(choice)、谁更可能(who)、填空题(fill)
- 选择题需要有 4 个选项，要有趣、贴近情侣日常
- "谁更可能"题选项固定为 ["我", "TA"]
- 填空题不需要选项
- 题目要有新意，不要老套（不要"最喜欢的颜色""最喜欢的食物"这种）
- 可以是关于异地恋、日常相处、旅行、美食、未来规划等话题
- category 字段用中文标签，如"默契""日常""旅行""美食""未来""甜蜜"

返回纯 JSON，不要 markdown 代码块，格式如下：
{"type":"choice或who或fill","q":"题目文字","options":["选项1","选项2","选项3","选项4"],"category":"分类标签"}`;

  const text = await callDeepSeek([
    { role: 'system', content: '你是一个创意情侣游戏出题助手。只返回纯 JSON，不要任何其他文字。' },
    { role: 'user', content: prompt },
  ], apiKey, 400);

  // 清理可能的 markdown 代码块
  let json = text.trim();
  if (json.startsWith('```')) {
    json = json.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }
  return JSON.parse(json);
}

async function generateAICommentary(question, answers, apiKey) {
  const answerList = Object.values(answers).map(function (a) {
    return a.nickname + '：' + a.answer;
  }).join('\n');

  const prompt = '题目：' + question.q + '\n\n两人的回答：\n' + answerList +
    '\n\n请用 2-3 句话点评这对情侣的回答。风格要甜、有趣、暖心，像朋友在调侃又像在祝福。不要重复题目和答案，直接给出评语。';

  return callDeepSeek([
    { role: 'system', content: '你是一个温暖又幽默的恋爱观察员。点评情侣的默契回答，风格甜趣暖心。' },
    { role: 'user', content: prompt },
  ], apiKey, 250);
}

async function generateAISummary(history, players, apiKey) {
  var rounds = '';
  history.forEach(function (item, i) {
    rounds += '第' + (i + 1) + '题：' + item.question.q + '\n';
    Object.values(item.answers).forEach(function (a) {
      rounds += '  ' + a.nickname + '：' + a.answer + '\n';
    });
    rounds += item.bonus ? '  → 默契！\n\n' : '  → 想法不同\n\n';
  });

  var playerNames = Object.values(players).map(function (p) { return p.nickname; }).join(' 和 ');
  var scores = Object.values(players).map(function (p) { return p.nickname + ' ' + p.score + '分'; }).join('，');

  var prompt = '这对情侣刚完成了一局默契挑战。\n\n' +
    '玩家：' + playerNames + '\n得分：' + scores + '\n\n' +
    '全部问答记录：\n' + rounds +
    '\n请根据以上内容，写一段 120 字左右的暖心总结。风格像一封短信，温暖、真诚，可以适当调侃但充满祝福。提到一两处他们回答中具体的有趣细节。不要用"亲爱的XX"开头，直接开始写。';

  return callDeepSeek([
    { role: 'system', content: '你是一个温暖真诚的情感写作者。为情侣游戏写暖心总结，风格自然不油腻。' },
    { role: 'user', content: prompt },
  ], apiKey, 400);
}

// ===================== 主题定义 =====================
var THEMES = {
  random:   { name: '🎲 随机混搭',  desc: '各种题型随机出现，每次都有惊喜', icon: '🎲' },
  food:     { name: '🍜 美食',      desc: '关于吃的甜蜜默契', icon: '🍜' },
  travel:   { name: '✈️ 旅行',      desc: '想象一起出行的场景', icon: '✈️' },
  love:     { name: '💕 恋爱',      desc: '关于我们之间的那些事', icon: '💕' },
  daily:    { name: '🏠 日常',      desc: '宅在一起的日常想象', icon: '🏠' },
  deeptalk: { name: '💬 真心话',    desc: '走心的问题，更了解彼此', icon: '💬' },
  ai:       { name: '🤖 AI 智能出题', desc: 'DeepSeek 实时生成，永不重复', icon: '🤖' },
};

// ===================== 题库 =====================
var QUESTION_BANK = {
  food: [
    { type: 'choice', q: '下次见面第一顿最想一起吃什么？', options: ['火锅', '日料', '路边摊小吃', '在家一起做'] },
    { type: 'choice', q: 'TA 最可能挑食的食物是？', options: ['香菜', '胡萝卜', '青椒', 'TA 不挑食'] },
    { type: 'who',    q: '谁做饭更好吃？', options: ['我', 'TA'] },
    { type: 'choice', q: '深夜饿了，你更想和 TA 一起吃什么？', options: ['泡面配鸡蛋', '烧烤摊', '冰箱剩菜瞎凑合', '点外卖'] },
    { type: 'fill',   q: '你吃过 TA 做的（或描述过的）最好吃的东西是什么？', options: [] },
    { type: 'choice', q: '如果一起开一家店，你们想开什么？', options: ['甜品店', '深夜食堂', '咖啡书店', '奶茶店'] },
    { type: 'who',    q: '谁更容易把厨房炸了？', options: ['我', 'TA'] },
    { type: 'choice', q: '一起逛超市，TA 最可能先冲向哪个区？', options: ['零食区', '水果区', '熟食区', '酒水区'] },
    { type: 'fill',   q: '说出 TA 最爱吃的一个东西，要具体到怎么做的', options: [] },
    { type: 'choice', q: '如果 TA 给你做了一顿饭，你觉得会是什么菜？', options: ['番茄炒蛋', '牛排红酒', '一锅乱炖', '就...一碗面'] },
  ],
  travel: [
    { type: 'choice', q: '如果能一起去旅行，第一站去哪儿？', options: ['海边度假', '古城小巷', '雪山温泉', '繁华都市'] },
    { type: 'choice', q: 'TA 最想和你在旅途中做什么？', options: ['一起看日出', '逛当地集市', '躺在酒店不出去', '拍一大堆照片'] },
    { type: 'who',    q: '谁更可能迷路？', options: ['我', 'TA'] },
    { type: 'choice', q: '旅行中，TA 更可能在什么东西上花钱？', options: ['美食', '纪念品', '体验项目', '住宿'] },
    { type: 'fill',   q: '如果只带一件东西，你觉得 TA 会给你们的旅行带什么？', options: [] },
    { type: 'who',    q: '谁收拾行李更快？', options: ['我', 'TA'] },
    { type: 'choice', q: '旅行的方式，你们更倾向哪种？', options: ['特种兵式打卡', '慢悠悠闲逛', '跟着感觉走', '提前规划每一站'] },
    { type: 'fill',   q: '你最想和 TA 一起去的城市是哪里？（三个字以内）', options: [] },
    { type: 'choice', q: '旅途中 TA 最可能说什么？', options: ['"好美啊！"', '"好累啊..."', '"这个好好吃！"', '"我们再待一天吧"'] },
    { type: 'who',    q: '谁拍照更好看？', options: ['我', 'TA'] },
  ],
  love: [
    { type: 'fill',   q: '用三个词形容 TA 在你心里的样子', options: [] },
    { type: 'choice', q: '你觉得哪种方式最浪漫？', options: ['睡前互道晚安', '突然收到 TA 点的外卖', 'TA 记住你随口说的话', '一起规划下次见面'] },
    { type: 'fill',   q: 'TA 做过的哪件小事，让你觉得"就是这个人了"？', options: [] },
    { type: 'who',    q: '谁先心动的？', options: ['我', 'TA'] },
    { type: 'choice', q: '你更希望收到什么礼物？', options: ['一封手写信', '一个惊喜包裹', '一首 TA 唱的歌', '一起的合照拼图'] },
    { type: 'fill',   q: '第一次见到 TA 时，你心里在想什么？', options: [] },
    { type: 'who',    q: '谁更爱撒娇？', options: ['我', 'TA'] },
    { type: 'choice', q: '你觉得 TA 最喜欢你的什么？', options: ['性格', '外表', '才华', '对我好的方式'] },
    { type: 'fill',   q: '如果有超能力，你最想为 TA 做什么？', options: [] },
    { type: 'who',    q: '谁更可能突然给对方惊喜？', options: ['我', 'TA'] },
  ],
  daily: [
    { type: 'choice', q: '宅在家的时候，TA 更想干嘛？', options: ['一起追剧', '各玩各的', '一起做饭', '打游戏'] },
    { type: 'choice', q: '下雨天最想 TA 在你身边做什么？', options: ['窝在沙发聊天', '一起听雨发呆', '煮一壶热茶', '打伞散步'] },
    { type: 'who',    q: '谁更可能睡过头？', options: ['我', 'TA'] },
    { type: 'choice', q: '如果一起住，家务怎么分？', options: ['我做清洁 TA 做饭', 'TA 全包（我想得美）', '我全包（TA 想得美）', '一起干，谁也别逃'] },
    { type: 'fill',   q: '描述一下：和 TA 住在一起的第一天早上，是什么画面？', options: [] },
    { type: 'who',    q: '谁更可能把东西弄丢？', options: ['我', 'TA'] },
    { type: 'choice', q: '晚上睡不着，你更希望 TA 怎么做？', options: ['打电话陪你聊', '给你讲故事', '陪你看剧到睡着', 'TA 睡你的，不用管我'] },
    { type: 'who',    q: '谁更可能在电影院睡着？', options: ['我', 'TA'] },
    { type: 'fill',   q: '你觉得 TA 最需要被照顾的一个瞬间是什么？', options: [] },
    { type: 'choice', q: 'TA 在家最可能躺在哪？', options: ['沙发上刷手机', '床上不起来', '地毯上瘫着', '厨房站着吃东西'] },
  ],
  deeptalk: [
    { type: 'fill',   q: '异地这段时间，你学到最重要的一件事是什么？', options: [] },
    { type: 'fill',   q: '你觉得十年后的你们，会在哪里、在做什么？', options: [] },
    { type: 'choice', q: '吵架了，你觉得什么方式最能让你们和好？', options: ['一个人先服软', '冷静后好好聊', '一个拥抱就够了', '发一个搞笑表情包'] },
    { type: 'fill',   q: '你最想对 TA 说但一直没说出口的一句话是什么？', options: [] },
    { type: 'choice', q: '你觉得一段感情里最重要的是什么？', options: ['信任', '沟通', '陪伴', '一起成长'] },
    { type: 'fill',   q: '你觉得你们最默契的一个瞬间是什么？', options: [] },
    { type: 'who',    q: '谁更记不住纪念日？', options: ['我', 'TA'] },
    { type: 'choice', q: '你觉得你们在一起最大的变化是什么？', options: ['变温柔了', '变幼稚了', '变勇敢了', '变得更像对方了'] },
    { type: 'fill',   q: '给 3 个月后的 TA 写一句话吧', options: [] },
    { type: 'who',    q: '吵架时谁先道歉？', options: ['我', 'TA'] },
  ],
};

// ===================== 挑战卡 =====================
var CHALLENGES = [
  { text: '给对方发一段语音："你今天真好看"', emoji: '🎙️' },
  { text: '截屏这个画面，发给对方', emoji: '📸' },
  { text: '对着屏幕比个心，等对方也做了再继续', emoji: '🫶' },
  { text: '原地转三圈！然后告诉对方你晕了', emoji: '🌀' },
  { text: '现在立刻给对方发一个你最喜欢的表情包', emoji: '🤪' },
  { text: '学一种动物的叫声，发给对方听', emoji: '🐱' },
  { text: '闭上眼睛想 TA 的脸，想 10 秒再睁开', emoji: '💭' },
  { text: '用最快的速度打出"我喜欢你"，看谁先发出', emoji: '⏱️' },
  { text: '现在马上跟对方说一句今天还没说的话', emoji: '💌' },
  { text: '站起来，做一个搞笑的动作发给对方看', emoji: '🕺' },
  { text: '给对方发一条语音，只用一个字描述今天的心情', emoji: '🎤' },
  { text: '想象对方正在你面前，做一个你见面会做的第一件事', emoji: '💕' },
];

// ===================== 每日彩蛋题 =====================
function getDailyQuestion() {
  var days = [
    { type: 'fill', q: '周一：这周你最期待和 TA 一起做的一件事是什么？', options: [] },
    { type: 'choice', q: '周二：今天最想和 TA 一起喝什么？', options: ['咖啡', '奶茶', '白水就够', '喝酒！'] },
    { type: 'fill',   q: '周三：一周过半，想对 TA 说什么？', options: [] },
    { type: 'choice', q: '周四：周末快到了，你最想和 TA 做什么？', options: ['视频到很晚', '一起看一部电影', '什么也不做，就挂着', '玩一局游戏'] },
    { type: 'fill',   q: '周五：用一个颜色形容今天的心情，为什么？', options: [] },
    { type: 'choice', q: '周六：如果此刻 TA 就在身边，你最可能干嘛？', options: ['拥抱一下', '拉着出门', '一起躺着', '去做饭'] },
    { type: 'fill',   q: '周日：这周最想对 TA 说谢谢的一件事是什么？', options: [] },
  ];
  var now = new Date();
  var idx = (now.getDay() + now.getDate()) % days.length;
  return days[idx];
}

// ===================== 帮助函数 =====================
function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

// ===================== 房间管理 =====================
var rooms = {};
var TOTAL_ROUNDS = 5;

function createRoom(roomName, hostName, themeKey, apiKey) {
  return {
    name: roomName,
    players: {},
    theme: themeKey || 'random',
    apiKey: apiKey || '',
    round: 0,
    totalRounds: TOTAL_ROUNDS,
    state: 'waiting',
    questions: [],
    roundHistory: [],
    challengeInjected: false,
  };
}

async function pickQuestion(room) {
  // 每日彩蛋题
  if (room.round === 1 && Math.random() < 0.3) {
    return getDailyQuestion();
  }

  // 挑战卡
  if (room.round === 3 && !room.challengeInjected && Math.random() < 0.4) {
    room.challengeInjected = true;
    return {
      type: 'challenge',
      category: '小挑战',
      q: CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)].text,
      options: ['我完成了！', 'TA 先完成！'],
      emoji: '⚡',
    };
  }

  // AI 智能出题
  if (room.theme === 'ai' && room.apiKey) {
    try {
      var aiQ = await generateAIQuestion(room.apiKey);
      room.questions.push('ai_' + room.round);
      return aiQ;
    } catch (e) {
      console.error('AI 出题失败，回退到随机题库:', e.message);
      // 降级到随机题库
    }
  }

  // 按主题选题
  var pool = [];
  if (room.theme === 'random' || room.theme === 'ai') {
    for (var key in QUESTION_BANK) {
      pool = pool.concat(QUESTION_BANK[key]);
    }
  } else {
    pool = QUESTION_BANK[room.theme] || [];
  }

  var used = new Set(room.questions);
  var available = pool.filter(function (q, i) { return !used.has(room.theme + '_' + i); });
  if (available.length === 0) {
    room.questions = [];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  var q = available[Math.floor(Math.random() * available.length)];
  var poolIdx = pool.indexOf(q);
  room.questions.push(room.theme + '_' + poolIdx);
  return q;
}

// ===================== Socket.IO =====================
io.on('connection', function (socket) {
  console.log('[+] ' + socket.id);

  socket.on('create_room', function (data, cb) {
    var roomName = data.roomName;
    var nickname = data.nickname;
    var theme = data.theme;
    var apiKey = data.apiKey || '';
    var roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    var room = createRoom(roomName, nickname, theme, apiKey);
    room.players[socket.id] = { id: socket.id, nickname: nickname, score: 0, streak: 0 };
    rooms[roomId] = room;
    socket.join(roomId);
    socket.data = { roomId: roomId, nickname: nickname };
    cb({ ok: true, roomId: roomId, room: roomInfo(room, roomId) });
    io.to(roomId).emit('room_update', roomInfo(room, roomId));
    console.log('[ROOM] ' + roomId + ' (' + (THEMES[theme] ? THEMES[theme].name : 'AI') + ') by ' + nickname);
  });

  socket.on('join_room', function (data, cb) {
    var r = (data.roomId || '').toUpperCase();
    var nickname = data.nickname;
    var room = rooms[r];
    if (!room) return cb({ ok: false, error: '房间不存在' });
    if (Object.keys(room.players).length >= 2) return cb({ ok: false, error: '房间已满' });
    room.players[socket.id] = { id: socket.id, nickname: nickname, score: 0, streak: 0 };
    socket.join(r);
    socket.data = { roomId: r, nickname: nickname };
    cb({ ok: true, roomId: r, room: roomInfo(room, r) });
    io.to(r).emit('room_update', roomInfo(room, r));
  });

  socket.on('start_game', function () {
    var room = getRoom(socket);
    if (!room || Object.keys(room.players).length < 2) return;
    if (room.state !== 'waiting') return;
    room.state = 'playing';
    room.round = 0;
    room.questions = [];
    room.roundHistory = [];
    room.challengeInjected = false;
    Object.values(room.players).forEach(function (p) { p.score = 0; p.streak = 0; });
    nextRound(room);
  });

  socket.on('submit_answer', function (answer) {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing') return;
    room._answers = room._answers || {};
    room._answers[socket.id] = answer;

    io.to(socket.data.roomId).emit('player_answered', {
      playerId: socket.id,
      nickname: socket.data.nickname,
    });

    if (Object.keys(room.players).every(function (pid) { return room._answers[pid]; })) {
      revealRound(room);
    }
  });

  socket.on('next_round', function () {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing') return;
    room._answers = {};
    nextRound(room);
  });

  socket.on('play_again', function () {
    var room = getRoom(socket);
    if (!room) return;
    room.state = 'waiting';
    room.round = 0;
    room.questions = [];
    room.roundHistory = [];
    room._answers = {};
    room.challengeInjected = false;
    Object.values(room.players).forEach(function (p) { p.score = 0; p.streak = 0; });
    io.to(socket.data.roomId).emit('room_update', roomInfo(room, socket.data.roomId));
  });

  socket.on('disconnect', function () {
    var room = getRoom(socket);
    if (!room) return;
    var rid = socket.data.roomId;
    delete room.players[socket.id];
    if (Object.keys(room.players).length === 0) {
      delete rooms[rid];
    } else {
      room.state = 'waiting';
      room._answers = {};
      io.to(rid).emit('partner_left');
      io.to(rid).emit('room_update', roomInfo(room, rid));
    }
  });
});

function getRoom(socket) {
  return rooms[socket.data ? socket.data.roomId : ''];
}

function roomInfo(room, rid) {
  return {
    roomId: rid,
    name: room.name,
    theme: room.theme,
    themeLabel: THEMES[room.theme] ? THEMES[room.theme].name : '',
    hasAI: !!(room.apiKey && room.theme === 'ai'),
    state: room.state,
    round: room.round,
    totalRounds: room.totalRounds,
    players: (function () {
      var obj = {};
      Object.keys(room.players).forEach(function (id) {
        var p = room.players[id];
        obj[id] = { nickname: p.nickname, score: p.score, streak: p.streak };
      });
      return obj;
    })(),
  };
}

function getRoomId(room) {
  for (var rid in rooms) { if (rooms[rid] === room) return rid; }
  return '';
}

async function nextRound(room) {
  room.round++;
  if (room.round > room.totalRounds) return finishGame(room);

  var q = await pickQuestion(room);
  room.currentQuestion = q;
  room._answers = {};

  io.to(getRoomId(room)).emit('new_round', {
    round: room.round,
    totalRounds: room.totalRounds,
    question: q,
  });
}

async function revealRound(room) {
  var playerIds = Object.keys(room.players);
  var answers = {};
  for (var i = 0; i < playerIds.length; i++) {
    var pid = playerIds[i];
    answers[pid] = {
      nickname: room.players[pid].nickname,
      answer: room._answers[pid],
    };
  }

  var q = room.currentQuestion;
  var bonus = 0;

  if (q.type === 'who') {
    var vals = Object.values(room._answers);
    if (vals[0] !== vals[1]) bonus = 1;
  } else if (q.type === 'choice') {
    var vals2 = Object.values(room._answers);
    if (vals2[0] === vals2[1]) bonus = 1;
  }

  if (bonus) {
    Object.values(room.players).forEach(function (p) {
      p.score += bonus;
      p.streak = (p.streak || 0) + 1;
    });
  } else {
    Object.values(room.players).forEach(function (p) { p.streak = 0; });
  }

  room.roundHistory.push({
    question: q,
    answers: answers,
    bonus: bonus > 0,
  });

  var rid = getRoomId(room);
  io.to(rid).emit('round_result', { answers: answers, question: q, bonus: bonus > 0 });
  io.to(rid).emit('room_update', roomInfo(room, rid));

  // AI 点评（异步，不阻塞）
  if (room.apiKey) {
    try {
      var commentary = await generateAICommentary(q, answers, room.apiKey);
      io.to(rid).emit('ai_commentary', { text: commentary });
    } catch (e) {
      console.error('AI 点评失败:', e.message);
    }
  }
}

async function finishGame(room) {
  room.state = 'finished';
  var rid = getRoomId(room);
  var sorted = Object.values(room.players).sort(function (a, b) { return b.score - a.score; });
  var total = sorted.reduce(function (s, p) { return s + p.score; }, 0);

  var VERDICTS = [
    { min: 0, text: '看来你们还有很多惊喜等着彼此去发现呢 ✨', emoji: '🌱' },
    { min: 1, text: '默契正在慢慢发芽～多聊聊吧 💕',           emoji: '🌿' },
    { min: 2, text: '有在认真了解彼此哦！继续加油 🫶',         emoji: '🌸' },
    { min: 3, text: '很不错！你们对彼此的了解程度很高了 💖',    emoji: '💐' },
    { min: 4, text: '太强了吧！简直是灵魂伴侣 💯',              emoji: '🔥' },
    { min: 5, text: '满分默契！你俩就是命中注定 🎯',            emoji: '👑' },
  ];
  var verdict = VERDICTS.filter(function (v) { return total >= v.min; }).pop() || VERDICTS[0];

  io.to(rid).emit('game_finished', {
    players: sorted.map(function (p) { return { nickname: p.nickname, score: p.score }; }),
    verdict: verdict.text + ' ' + verdict.emoji,
    emoji: verdict.emoji,
    history: room.roundHistory,
  });
  io.to(rid).emit('room_update', roomInfo(room, rid));

  // AI 情感总结（异步，不阻塞）
  if (room.apiKey && room.roundHistory.length > 0) {
    try {
      var summary = await generateAISummary(room.roundHistory, room.players, room.apiKey);
      io.to(rid).emit('ai_summary', { text: summary });
    } catch (e) {
      console.error('AI 总结失败:', e.message);
    }
  }
}

var PORT = process.env.PORT || 3456;

server.listen(PORT, function () {
  console.log('💞 情侣默契挑战 v3 (AI)  http://localhost:' + PORT);
});
