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

async function callDeepSeek(messages, apiKey, maxTokens) {
  var res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({ model: DEEPSEEK_MODEL, messages: messages, temperature: 1.5, max_tokens: maxTokens || 600 }),
  });
  if (!res.ok) { var err = await res.text(); throw new Error('DeepSeek error ' + res.status + ': ' + err); }
  var data = await res.json();
  return data.choices[0].message.content;
}

async function generateAIQuestion(apiKey) {
  var prompt = '你是一个充满诗意和想象力的情侣游戏出题助手。为异地恋情侣生成一道有趣、有深度、不走寻常路的题目。\n\n要求：\n- 随机选择题目类型：选择题(choice)、谁更可能(who)、填空题(fill)\n- 选择题需要 4 个有画面感的选项\n- "谁更可能"题选项固定为 ["我", "TA"]\n- 填空题不需要选项\n- 题目要有诗意、想象力、独特，不要老套的"最喜欢什么颜色"这种\n- 可以涉及：命运的相遇、时间的意义、记忆的碎片、共同的未来、灵魂的共鸣、日常中的诗意、假设性的幻想、抽象的情感比喻\n- category 字段用中文标签\n\n返回纯 JSON，不要 markdown：\n{"type":"choice或who或fill","q":"题目","options":["选项1"...],"category":"标签"}';
  var text = await callDeepSeek([{ role: 'system', content: '你是一个富有诗意和创造力的出题人。只返回纯 JSON，不要任何其他文字。你的题目要有深度、有画面感、能触动人心。' }, { role: 'user', content: prompt }], apiKey, 500);
  var json = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(json);
}

async function generateAICommentary(question, answers, apiKey) {
  var list = Object.values(answers).map(function (a) { return a.nickname + '：' + a.answer; }).join('\n');
  var prompt = '题目：' + question.q + '\n\n回答：\n' + list + '\n\n用像诗一样的语言，温柔地点评他们回答里藏着的深情。2-3 句，有画面感。';
  return callDeepSeek([{ role: 'system', content: '你是温柔的情感观察者，用诗意语言点评情侣之间的默契。' }, { role: 'user', content: prompt }], apiKey, 300);
}

async function generateAISummary(history, players, apiKey) {
  var rounds = '';
  history.forEach(function (item, i) {
    rounds += '第' + (i + 1) + '题：' + item.question.q + '\n';
    Object.values(item.answers).forEach(function (a) { rounds += '  ' + a.nickname + '：' + a.answer + '\n'; });
  });
  var names = Object.values(players).map(function (p) { return p.nickname; }).join(' 和 ');
  return callDeepSeek([{ role: 'system', content: '你是温柔而深邃的情感写作者。用诗意的语言为情侣游戏写总结，像来自星空的情书。' }, { role: 'user', content: '玩家：' + names + '\n问答：\n' + rounds + '\n写 150 字诗意暖心总结，要有画面感和情感深度。' }], apiKey, 500);
}

// ===================== 游戏模式 =====================
var GAME_MODES = {
  quiz:     { name: '💞 默契挑战', desc: '答题测默契，看谁更懂谁', icon: '💞' },
  story:    { name: '📝 故事接龙', desc: '一人一句，编一个属于你们的故事', icon: '📝' },
  wishlist: { name: '📋 愿望清单', desc: '一起写想一起做的事，攒到见面', icon: '📋' },
  roleplay: { name: '🎭 情景扮演', desc: '给一个场景，各自写你会怎么做', icon: '🎭' },
  draw:     { name: '🎨 你画我猜', desc: '一个人画，另一个人猜是什么', icon: '🎨' },
  spy:      { name: '🃏 谁是卧底', desc: '两人拿相似词，猜对方是什么词', icon: '🃏' },
  truthlie: { name: '🕵️ 真假日常', desc: '写三件事其中一件是假的，TA来猜', icon: '🕵️' },
  monopoly: { name: '🎲 恋爱飞行棋', desc: '掷骰子走格子，每格有小惊喜', icon: '🎲' },
};

// ===================== 默契挑战 - 主题和题库 =====================
var THEMES = {
  random:   { name: '🎲 随机混搭',  desc: '各种题型随机出现', icon: '🎲' },
  food:     { name: '🍜 美食',      desc: '关于吃的甜蜜默契', icon: '🍜' },
  travel:   { name: '✈️ 旅行',      desc: '想象一起出行的场景', icon: '✈️' },
  love:     { name: '💕 恋爱',      desc: '关于我们之间的那些事', icon: '💕' },
  daily:    { name: '🏠 日常',      desc: '宅在一起的日常想象', icon: '🏠' },
  deeptalk: { name: '💬 真心话',    desc: '走心的问题', icon: '💬' },
  ai:       { name: '🤖 AI 智能出题', desc: 'DeepSeek 实时生成', icon: '🤖' },
};

var QUESTION_BANK = require("./questions.js");
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
];

// ===================== 故事接龙 - 开头 =====================
var STORY_PROMPTS = [
  '有一天，我们终于不用异地了。那天早上...',
  '如果有一天，我们拥有了一台时光机...',
  '在一个下雨的周末午后，窗外灰蒙蒙的...',
  '那天 TA 突然出现在我的城市，手里拿着...',
  '十年后的我们，坐在阳台上，回忆着...',
  '我们的猫咪/狗狗突然开口说话了，它说...',
  '如果我们是童话里的两个角色...',
  '第一次和 TA 视频的时候，屏幕上出现的是...',
  '我们的下一次约会，选在了一个很特别的地方...',
  '那天晚上，手机突然响了，是 TA 打来的...',
  '假如我们能飞到世界的任何一个角落...',
  '618 天之后，我们终于...',
];

// ===================== 愿望清单 - 提示 =====================
var WISHLIST_PROMPTS = [
  { q: '下一次见面，最想做的一件事是什么？', icon: '💑' },
  { q: '想和 TA 一起去哪里旅行？（越具体越好）', icon: '✈️' },
  { q: '想和 TA 一起学什么新技能？', icon: '🎯' },
  { q: '想给 TA 做一道什么菜？', icon: '🍳' },
  { q: '你想象中最完美的约会是什么样子？', icon: '💕' },
  { q: '想和 TA 一起看的电影 / 剧是什么？', icon: '🎬' },
  { q: '最想对 TA 当面说的一句话', icon: '💌' },
  { q: '如果能和 TA 一起创业，想开一家什么店？', icon: '🏪' },
  { q: '想和 TA 一起养宠物吗？什么样的？', icon: '🐱' },
  { q: '今年最想为 TA 做的一件事', icon: '🎁' },
  { q: '最想和 TA 一起过的节日 / 纪念日怎么过？', icon: '🎂' },
  { q: '你们老了以后，希望每天的生活是什么样？', icon: '🌅' },
];

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
  return days[(now.getDay() + now.getDate()) % days.length];
}

function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

// XSS sanitize: escape HTML in user input
function esc(s) {
  return (s || '').toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

// Room GC: clean rooms older than 2 hours with no players
function roomGC() {
  var now = Date.now();
  for (var rid in rooms) {
    var r = rooms[rid];
    if (Object.keys(r.players).length === 0 && now - r._createdAt > 7200000) {
      delete rooms[rid];
    }
  }
}
setInterval(roomGC, 600000); // every 10 min

// ===================== 房间 =====================
var rooms = {};
var TOTAL_ROUNDS = 5;
var STORY_ROUNDS = 6;
var WISHLIST_ROUNDS = 5;
var ROLEPLAY_ROUNDS = 3;
var DRAW_ROUNDS = 4;
var SPY_ROUNDS = 3;
var TRUTHLIE_ROUNDS = 3;
var MONOPOLY_BOARD = 25;

// 谁是卧底 - 相似词对
var SPY_PAIRS = [
  ['拥抱', '牵手'],
  ['喜欢', '想念'],
  ['早安', '晚安'],
  ['下雨', '下雪'],
  ['火锅', '烧烤'],
  ['咖啡', '奶茶'],
  ['电影', '剧集'],
  ['日记', '情书'],
  ['日出', '日落'],
  ['海边', '山顶'],
  ['蛋糕', '饼干'],
  ['钢琴', '吉他'],
  ['春天', '秋天'],
  ['星星', '月亮'],
  ['猫咪', '狗狗'],
  ['眼睛', '笑容'],
  ['回家', '见面'],
  ['等待', '期盼'],
  ['悄悄', '偷偷'],
  ['温柔', '体贴'],
];

// 恋爱飞行棋 - 格子内容
function genMonopolySquares() {
  var squares = [
    { type: 'q', text: '说一件今天让你想到TA的事', icon: '💭' },
    { type: 'a', text: '发给TA一个亲亲的表情包', icon: '😘' },
    { type: 'q', text: '上一次见到TA时，你第一句话说了什么？', icon: '💬' },
    { type: 'b', text: '前进2格——因为TA也在想你', icon: '✨' },
    { type: 'q', text: '你觉得TA今天最开心的一件事是什么？', icon: '🔮' },
    { type: 'a', text: '现在立刻给TA发一条语音说"加油"', icon: '🎤' },
    { type: 'b', text: '后退1格——刷到前任的动态（开玩笑的，重来吧）', icon: '😅' },
    { type: 'q', text: '你最喜欢的关于TA的一个记忆是什么？', icon: '📸' },
    { type: 'a', text: '说出TA身上你最喜欢的一个细节', icon: '👀' },
    { type: 'q', text: '如果TA是超级英雄，TA的超能力会是什么？', icon: '🦸' },
    { type: 'b', text: '前进3格——TA刚刚说想你', icon: '💕' },
    { type: 'q', text: '异地这段时间，你最怀念TA的什么？', icon: '💭' },
    { type: 'a', text: '闭上眼睛想TA 10秒，然后告诉TA你刚想了什么', icon: '💫' },
    { type: 'b', text: '暂停一轮——网络延迟中...', icon: '📡' },
    { type: 'q', text: '你觉得十年后的你们在做哪顿饭？', icon: '🍳' },
    { type: 'a', text: '发一条只有三个字的消息给TA', icon: '📝' },
    { type: 'q', text: '你觉得TA此刻在想什么？猜一下', icon: '🤔' },
    { type: 'b', text: '后退2格——被路边的小猫分散了注意力', icon: '🐱' },
    { type: 'q', text: '你觉得你们的爱情最像什么？', icon: '💖' },
    { type: 'a', text: '两人都打一个爱心emoji然后截图', icon: '💗' },
    { type: 'b', text: '前进4格——你们心有灵犀！', icon: '🎯' },
    { type: 'q', text: '第一次见面，你穿的是什么？', icon: '👗' },
    { type: 'a', text: '现在做个搞笑的表情发给对方', icon: '🤪' },
    { type: 'q', text: '你觉得TA做的最让你感动的一件事是什么？', icon: '🥹' },
    { type: 'b', text: '终点在望！再来一次', icon: '🏁' },
  ];
  // shuffle
  var arr = squares.slice();
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

// ===================== 情景扮演 - 场景 =====================
var ROLEPLAY_SCENARIOS = [
  '这是你们异地结束后的第一天，你睁开眼睛，TA 就在身边。你接下来会做什么？',
  '你们的第一次约会，你来做计划。从早上 9 点到晚上 10 点，你怎么安排？',
  '有一天你突然出现在 TA 的城市，没有提前告诉 TA。你会怎么制造惊喜？',
  '你们在街上吵架了。你不想冷战，你会怎么打破僵局？',
  '如果你们一起去买菜做饭，从挑菜到上桌，你会怎么分工商量？',
  'TA 生日那天，你要给 TA 一个惊喜。你从早到晚怎么安排？',
  '你们在异国他乡迷路了，语言不通。只剩下你俩互相依靠，怎么办？',
  '你发现 TA 今天心情不好，隔着屏幕你怎么哄 TA 开心？',
  '假如你们只有 500 块，要过一个完美的周末约会，你怎么花？',
  '你们一起去宜家给未来的家挑家具，走到床品区的时候，你们的对话是什么？',
];

// ===================== 你画我猜 - 词语 =====================
var DRAW_WORDS = [
  '玫瑰', '月亮', '冰淇淋', '雨伞', '猫', '太阳', '蛋糕', '眼镜', '自行车',
  '耳机', '灯笼', '沙发', '枕头', '拖鞋', '牙刷', '星星', '信封', '气球',
  '拥抱', '牵手', '爱心', '戒指', '烟火', '行李箱', '相机', '闹钟', '奶茶',
  '棒棒糖', '望远镜', '自拍杆', '充电宝', '暖手宝', '情书', '纪念日',
  '异地恋', '早安', '晚安', '想你了', '见面', '拥抱你', '亲亲',
];

function createRoom(roomName, hostName, gameMode, themeKey, apiKey) {
  var cleanRoom = (roomName || '甜蜜小屋').toString().substring(0, 30);
  var cleanHost = (hostName || '').toString().substring(0, 15);
  return {
    name: cleanRoom,
    players: {},
    gameMode: gameMode || 'quiz',
    theme: themeKey || 'random',
    apiKey: (apiKey || '').toString().substring(0, 80),
    round: 0,
    totalRounds: TOTAL_ROUNDS,
    state: 'waiting',
    questions: [],
    roundHistory: [],
    challengeInjected: false,
    storyLines: [],
    storyPrompt: '',
    wishlistItems: [],
    wishlistPrompts: [],
    roleplayScenarios: [],
    roleplayAnswers: {},
    drawWords: [],
    drawRound: 0,
    drawWord: '',
    drawDrawer: '',
    // spy
    spyPair: null,
    spyWordA: '',
    spyWordB: '',
    spyRound: 0,
    spyDescriptions: [],
    // truthlie
    truthlieSet: [],
    truthlieRound: 0,
    // monopoly
    monopolySquares: [],
    monopolyPos: {},
    monopolyTurn: '',
    // guards against race conditions
    _quizLocked: false,
    _storyLocked: false,
    _createdAt: Date.now(),
  };
}

async function pickQuestion(room) {
  if (room.round === 1 && Math.random() < 0.3) return getDailyQuestion();
  if (room.round === 3 && !room.challengeInjected && Math.random() < 0.4) {
    room.challengeInjected = true;
    var c = CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
    return { type: 'challenge', category: '小挑战', q: c.text, options: ['我完成了！', 'TA 先完成！'], emoji: '⚡' };
  }
  if (room.theme === 'ai' && room.apiKey) {
    try {
      var aiQ = await generateAIQuestion(room.apiKey);
      room.questions.push('ai_' + room.round);
      return aiQ;
    } catch (e) { console.error('AI 出题失败，回退:', e.message); }
  }
  var pool = [];
  if (room.theme === 'random' || room.theme === 'ai') {
    for (var key in QUESTION_BANK) { pool = pool.concat(QUESTION_BANK[key]); }
  } else {
    pool = QUESTION_BANK[room.theme] || [];
  }
  // Fallback: if theme pool is empty, use all questions
  if (pool.length === 0) {
    for (var k2 in QUESTION_BANK) { pool = pool.concat(QUESTION_BANK[k2]); }
  }
  var used = new Set(room.questions);
  var available = pool.filter(function (q, i) { return !used.has(room.theme + '_' + i); });
  if (available.length === 0) { room.questions = []; available = pool; }
  var q = available[Math.floor(Math.random() * available.length)];
  room.questions.push(room.theme + '_' + pool.indexOf(q));
  return q;
}

// ===================== Socket.IO =====================
io.on('connection', function (socket) {
  console.log('[+] ' + socket.id);

  socket.on('create_room', function (data, cb) {
    var roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    var room = createRoom(data.roomName || '甜蜜小屋', data.nickname, data.gameMode || 'quiz', data.theme || 'random', data.apiKey || '');
    room.players[socket.id] = { id: socket.id, nickname: data.nickname, score: 0, streak: 0 };
    rooms[roomId] = room;
    socket.join(roomId);
    socket.data = { roomId: roomId, nickname: data.nickname };
    cb({ ok: true, roomId: roomId, room: roomInfo(room, roomId) });
    io.to(roomId).emit('room_update', roomInfo(room, roomId));
    console.log('[ROOM] ' + roomId + ' [' + (GAME_MODES[room.gameMode] ? GAME_MODES[room.gameMode].name : '') + '] by ' + data.nickname);
  });

  socket.on('join_room', function (data, cb) {
    var r = (data.roomId || '').toUpperCase();
    var room = rooms[r];
    if (!room) return cb({ ok: false, error: '房间不存在' });
    if (Object.keys(room.players).length >= 2) return cb({ ok: false, error: '房间已满' });
    room.players[socket.id] = { id: socket.id, nickname: data.nickname, score: 0, streak: 0 };
    socket.join(r);
    socket.data = { roomId: r, nickname: data.nickname };
    cb({ ok: true, roomId: r, room: roomInfo(room, r) });
    io.to(r).emit('room_update', roomInfo(room, r));
  });

  // ====== 开始游戏 ======
  socket.on('start_game', function () {
    var room = getRoom(socket);
    if (!room || Object.keys(room.players).length < 2) return;
    if (room.state !== 'waiting') return;
    room.state = 'playing';
    room.round = 0;

    if (room.gameMode === 'story') return startStory(room);
    if (room.gameMode === 'wishlist') return startWishlist(room);
    if (room.gameMode === 'roleplay') return startRoleplay(room);
    if (room.gameMode === 'draw') return startDraw(room);
    if (room.gameMode === 'spy') return startSpy(room);
    if (room.gameMode === 'truthlie') return startTruthLie(room);
    if (room.gameMode === 'monopoly') return startMonopoly(room);

    // quiz 模式
    room.questions = [];
    room.roundHistory = [];
    room.challengeInjected = false;
    room.totalRounds = TOTAL_ROUNDS;
    Object.values(room.players).forEach(function (p) { p.score = 0; p.streak = 0; });
    nextQuizRound(room).catch(function (e) { console.error('start_game quiz error:', e.message); });
  });

  // ====== 提交答案（quiz） ======
  socket.on('submit_answer', function (answer) {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing') return;
    if (room.gameMode !== 'quiz') return;
    // Guard: already submitted
    if (room._answers && room._answers[socket.id]) return;
    room._answers = room._answers || {};
    room._answers[socket.id] = esc(answer);
    io.to(socket.data.roomId).emit('player_answered', { playerId: socket.id, nickname: esc(socket.data.nickname) });
    if (Object.keys(room.players).every(function (pid) { return room._answers[pid]; })) {
      revealQuizRound(room).catch(function (e) { console.error('revealQuizRound error:', e.message); });
    }
  });

  // ====== 下一题（quiz） ======
  socket.on('next_round', function () {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing') return;
    if (room.gameMode !== 'quiz') return;
    // Guard: only proceed if both have submitted (prevent double-click skip)
    if (!room._answers || !Object.keys(room.players).every(function (pid) { return room._answers[pid]; })) return;
    room._answers = {};
    nextQuizRound(room).catch(function (e) { console.error('nextQuizRound error:', e.message); });
  });

  // ====== 故事接龙 - 提交一句 ======
  socket.on('submit_story_line', function (text) {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing' || room.gameMode !== 'story') return;
    // Guard: double-submit
    if (room._storyLocked) return;
    var pids = Object.keys(room.players);
    var turnIdx = room.storyLines.length % 2;
    if (socket.id !== pids[turnIdx]) return;
    room._storyLocked = true;
    room.storyLines.push({ nickname: esc(socket.data.nickname), text: esc(text).substring(0, 200) });
    room.round = room.storyLines.length;
    room._storyLocked = false;

    if (room.storyLines.length >= STORY_ROUNDS) {
      finishStory(room);
    } else {
      var nextPid = pids[(turnIdx + 1) % 2];
      var rid = getRoomId(room);
      io.to(rid).emit('story_update', {
        lines: room.storyLines,
        prompt: room.storyPrompt,
        totalRounds: STORY_ROUNDS,
        currentRound: room.storyLines.length + 1,
        turnPlayerId: nextPid,
        turnNickname: esc(room.players[nextPid].nickname),
        lastNickname: esc(socket.data.nickname),
      });
    }
  });

  // ====== 愿望清单 - 提交愿望 ======
  socket.on('submit_wish', function (text) {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing' || room.gameMode !== 'wishlist') return;
    if (room._answers && room._answers[socket.id]) return;
    room._answers = room._answers || {};
    room._answers[socket.id] = esc(text).substring(0, 200);
    io.to(socket.data.roomId).emit('player_answered', { playerId: socket.id, nickname: esc(socket.data.nickname) });
    if (Object.keys(room.players).every(function (pid) { return room._answers[pid]; })) {
      revealWishlistRound(room);
    }
  });

  // ====== 愿望清单 - 下一轮 ======
  socket.on('wishlist_next', function () {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing' || room.gameMode !== 'wishlist') return;
    if (!room._answers || !Object.keys(room.players).every(function (pid) { return room._answers[pid]; })) return;
    room._answers = {};
    nextWishlistRound(room);
  });

  // ====== 情景扮演 - 提交 ======
  socket.on('submit_roleplay', function (text) {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing' || room.gameMode !== 'roleplay') return;
    if (room.roleplayAnswers && room.roleplayAnswers[socket.id]) return;
    room.roleplayAnswers = room.roleplayAnswers || {};
    room.roleplayAnswers[socket.id] = esc(text).substring(0, 200);
    io.to(socket.data.roomId).emit('player_answered', { playerId: socket.id, nickname: esc(socket.data.nickname) });
    if (Object.keys(room.players).every(function (pid) { return room.roleplayAnswers[pid]; })) {
      revealRoleplay(room);
    }
  });

  socket.on('roleplay_next', function () {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing' || room.gameMode !== 'roleplay') return;
    if (!room.roleplayAnswers || !Object.keys(room.players).every(function (pid) { return room.roleplayAnswers[pid]; })) return;
    room.roleplayAnswers = {};
    nextRoleplayRound(room);
  });

  // ====== 你画我猜 - 画线 ======
  socket.on('draw_line', function (data) {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing' || room.gameMode !== 'draw') return;
    // 广播给另一人
    socket.to(socket.data.roomId).emit('draw_line', data);
  });

  socket.on('draw_clear', function () {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing' || room.gameMode !== 'draw') return;
    socket.to(socket.data.roomId).emit('draw_clear');
  });

  // ====== 你画我猜 - 猜词 ======
  socket.on('submit_guess', function (guess) {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing' || room.gameMode !== 'draw') return;
    if (!room.drawWord) return;
    // Guard: already guessed correctly this round
    if (room._guessCorrect) return;
    var g = esc(guess).substring(0, 30);
    var correct = g === room.drawWord;
    var rid = socket.data.roomId;
    if (correct) {
      room._guessCorrect = true;
      var pids = Object.keys(room.players);
      var drawerPid = room.drawDrawer;
      var guesserPid = pids.find(function (pid) { return pid !== drawerPid; });
      if (guesserPid) room.players[guesserPid].score = (room.players[guesserPid].score || 0) + 1;
      io.to(rid).emit('guess_result', {
        correct: true, guess: g,
        guesser: esc(socket.data.nickname), word: room.drawWord,
      });
      io.to(rid).emit('room_update', roomInfo(room, rid));
    } else {
      io.to(rid).emit('guess_result', {
        correct: false, guess: g,
        guesser: esc(socket.data.nickname),
      });
    }
  });

  socket.on('draw_next', function () {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing' || room.gameMode !== 'draw') return;
    // Guard: prevent skip if round not complete
    if (!room._guessCorrect) return;
    room._guessCorrect = false;
    room.drawRound++;
    if (room.drawRound > DRAW_ROUNDS) {
      finishDraw(room);
    } else {
      startDrawRound(room);
    }
  });

  // ====== 谁是卧底 - 描述 ======
  socket.on('spy_describe', function (text) {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing' || room.gameMode !== 'spy') return;
    var d = esc(text).substring(0, 100);
    room.spyDescriptions.push({ nickname: esc(socket.data.nickname), text: d });
    room.spyRound++;

    if (room.spyRound >= SPY_ROUNDS * 2) {
      revealSpy(room);
    } else {
      var pids = Object.keys(room.players);
      var nextPid = pids[room.spyRound % 2];
      var rid = getRoomId(room);
      io.to(rid).emit('spy_update', {
        descriptions: room.spyDescriptions,
        round: Math.floor(room.spyRound / 2) + 1,
        totalRounds: SPY_ROUNDS,
        speakerId: nextPid,
        speakerName: esc(room.players[nextPid].nickname),
      });
    }
  });

  socket.on('spy_guess', function (guess) {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing' || room.gameMode !== 'spy') return;
    room._answers = room._answers || {};
    room._answers[socket.id] = esc(guess).substring(50);
    io.to(socket.data.roomId).emit('player_answered', { playerId: socket.id, nickname: esc(socket.data.nickname) });
    if (Object.keys(room.players).every(function (pid) { return room._answers[pid]; })) {
      finishSpy(room);
    }
  });

  // ====== 真假日常 - 提交 ======
  socket.on('truthlie_submit', function (items) {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing' || room.gameMode !== 'truthlie') return;
    // items is array of 3 strings
    var clean = [];
    for (var i = 0; i < 3 && i < (items || []).length; i++) {
      clean.push(esc(items[i]).substring(0, 80));
    }
    while (clean.length < 3) clean.push('（漏填了）');
    room.truthlieSet.push({ playerId: socket.id, nickname: esc(socket.data.nickname), items: clean, lieIdx: -1 });
    io.to(socket.data.roomId).emit('player_answered', { playerId: socket.id, nickname: esc(socket.data.nickname) });

    if (room.truthlieSet.length >= 2 && room.truthlieRound === 0) {
      // Both submitted their items. First round: tell them to pick lie index
      room.truthlieRound = 1;
      room._answers = {};
      io.to(socket.data.roomId).emit('truthlie_pick_lie', { items: room.truthlieSet });
    }
  });

  socket.on('truthlie_lie_idx', function (idx) {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing' || room.gameMode !== 'truthlie') return;
    room._answers = room._answers || {};
    var li = parseInt(idx) || 0;
    if (li < 0 || li > 2) li = 0;
    room._answers[socket.id] = li;
    io.to(socket.data.roomId).emit('player_answered', { playerId: socket.id, nickname: esc(socket.data.nickname) });
    if (Object.keys(room.players).every(function (pid) { return room._answers[pid] !== undefined; })) {
      revealTruthLie(room, 1);
    }
  });

  socket.on('truthlie_guess', function (idx) {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing' || room.gameMode !== 'truthlie') return;
    room._answers = room._answers || {};
    var gi = parseInt(idx) || 0;
    if (gi < 0 || gi > 2) gi = 0;
    room._answers[socket.id] = gi;
    io.to(socket.data.roomId).emit('player_answered', { playerId: socket.id, nickname: esc(socket.data.nickname) });
    if (Object.keys(room.players).every(function (pid) { return room._answers[pid] !== undefined; })) {
      revealTruthLie(room, 2);
    }
  });

  socket.on('truthlie_next', function () {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing' || room.gameMode !== 'truthlie') return;
    room.truthlieSet = [];
    room._answers = {};
    room.truthlieRound = 0;
    io.to(socket.data.roomId).emit('truthlie_round', { round: (room.round || 0) + 1, totalRounds: TRUTHLIE_ROUNDS });
  });

  // ====== 恋爱飞行棋 - 掷骰子 ======
  socket.on('monopoly_roll', function () {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing' || room.gameMode !== 'monopoly') return;
    var pids = Object.keys(room.players);
    var turnIdx = (room.monopolyTurns || 0) % 2;
    var expected = pids[turnIdx];
    if (socket.id !== expected) return; // Not your turn
    room.monopolyTurns = (room.monopolyTurns || 0) + 1;

    var dice = Math.floor(Math.random() * 6) + 1;
    var pos = (room.monopolyPos[socket.id] || 0) + dice;
    if (pos >= MONOPOLY_BOARD - 1) pos = MONOPOLY_BOARD - 1;
    room.monopolyPos[socket.id] = pos;
    var square = room.monopolySquares[pos] || { type: 'q', text: '和TA分享此刻的心情', icon: '💬' };

    if (pos >= MONOPOLY_BOARD - 1) {
      finishMonopoly(room, socket.id);
    } else {
      io.to(getRoomId(room)).emit('monopoly_update', {
        dice: dice,
        playerId: socket.id,
        playerName: esc(socket.data.nickname),
        pos: pos,
        posOther: room.monopolyPos[expected === pids[0] ? pids[1] : pids[0]] || 0,
        total: MONOPOLY_BOARD,
        square: square,
        nextPlayerId: pids[(turnIdx + 1) % 2],
      });
    }
  });

  // ====== 重新开始 ======
  socket.on('play_again', function () {
    var room = getRoom(socket);
    if (!room) return;
    room.state = 'waiting';
    room.round = 0;
    room.questions = [];
    room.roundHistory = [];
    room._answers = {};
    room.challengeInjected = false;
    room.storyLines = [];
    room.storyPrompt = '';
    room.wishlistItems = [];
    room.wishlistPrompts = [];
    room.roleplayScenarios = [];
    room.roleplayAnswers = {};
    room.drawWords = [];
    room.drawRound = 0;
    room.drawWord = '';
    room.spyPair = null;
    room.spyWordA = '';
    room.spyWordB = '';
    room.spyRound = 0;
    room.spyDescriptions = [];
    room.truthlieSet = [];
    room.truthlieRound = 0;
    room.monopolySquares = [];
    room.monopolyPos = {};
    room.monopolyTurns = 0;
    Object.values(room.players).forEach(function (p) { p.score = 0; p.streak = 0; });
    io.to(socket.data.roomId).emit('room_update', roomInfo(room, socket.data.roomId));
  });

  // ====== 断开 ======
  socket.on('disconnect', function () {
    var room = getRoom(socket);
    if (!room) return;
    var rid = socket.data ? socket.data.roomId : '';
    if (!rid) return;
    delete room.players[socket.id];
    if (Object.keys(room.players).length === 0) {
      delete rooms[rid];
    } else {
      var wasPlaying = room.state === 'playing';
      room.state = 'waiting';
      room._answers = {};
      room._quizLocked = false;
      room._storyLocked = false;
      room._guessCorrect = false;
      io.to(rid).emit('partner_left');
      io.to(rid).emit('room_update', roomInfo(room, rid));
    }
  });
});

// ===================== 故事接龙逻辑 =====================
function startStory(room) {
  room.state = 'playing';
  room.round = 0;
  room.storyLines = [];
  room.storyPrompt = STORY_PROMPTS[Math.floor(Math.random() * STORY_PROMPTS.length)];
  var pids = Object.keys(room.players);
  var firstPid = pids[0];
  var rid = getRoomId(room);
  io.to(rid).emit('story_update', {
    lines: [],
    prompt: room.storyPrompt,
    totalRounds: STORY_ROUNDS,
    currentRound: 1,
    turnPlayerId: firstPid,
    turnNickname: room.players[firstPid].nickname,
  });
}

function finishStory(room) {
  room.state = 'finished';
  var rid = getRoomId(room);
  io.to(rid).emit('story_finished', {
    prompt: room.storyPrompt,
    lines: room.storyLines,
    fullStory: room.storyPrompt + '\n\n' + room.storyLines.map(function (l) {
      return l.nickname + '：' + l.text;
    }).join('\n'),
  });
  io.to(rid).emit('room_update', roomInfo(room, rid));
}

// ===================== 愿望清单逻辑 =====================
function startWishlist(room) {
  room.state = 'playing';
  room.round = 0;
  room.wishlistItems = [];
  room.wishlistPrompts = [];
  room.totalRounds = WISHLIST_ROUNDS;
  room._answers = {};
  nextWishlistRound(room);
}

function nextWishlistRound(room) {
  room.round++;
  if (room.round > WISHLIST_ROUNDS) return finishWishlist(room);
  room._answers = {};
  var available = WISHLIST_PROMPTS.filter(function (p) { return !room.wishlistPrompts.some(function (u) { return u.q === p.q; }); });
  if (available.length === 0) { room.wishlistPrompts = []; available = WISHLIST_PROMPTS; }
  var p = available[Math.floor(Math.random() * available.length)];
  room.wishlistPrompts.push(p);
  var rid = getRoomId(room);
  io.to(rid).emit('wishlist_round', {
    round: room.round,
    totalRounds: WISHLIST_ROUNDS,
    prompt: p,
  });
}

function revealWishlistRound(room) {
  var pids = Object.keys(room.players);
  var items = [];
  for (var i = 0; i < pids.length; i++) {
    items.push({ nickname: room.players[pids[i]].nickname, text: room._answers[pids[i]] });
  }
  var prompt = room.wishlistPrompts[room.wishlistPrompts.length - 1];
  room.wishlistItems.push({ prompt: prompt, answers: items });
  var rid = getRoomId(room);
  io.to(rid).emit('wishlist_reveal', {
    round: room.round,
    totalRounds: WISHLIST_ROUNDS,
    prompt: prompt,
    items: items,
  });
}

function finishWishlist(room) {
  room.state = 'finished';
  var rid = getRoomId(room);
  io.to(rid).emit('wishlist_finished', {
    items: room.wishlistItems,
  });
  io.to(rid).emit('room_update', roomInfo(room, rid));
}

// ===================== 默契挑战逻辑 =====================
async function nextQuizRound(room) {
  room.round++;
  if (room.round > room.totalRounds) return finishQuiz(room);
  var q = await pickQuestion(room);
  room.currentQuestion = q;
  room._answers = {};
  io.to(getRoomId(room)).emit('new_round', { round: room.round, totalRounds: room.totalRounds, question: q, mode: 'quiz' });
}

async function revealQuizRound(room) {
  var pids = Object.keys(room.players);
  var answers = {};
  for (var i = 0; i < pids.length; i++) {
    answers[pids[i]] = { nickname: room.players[pids[i]].nickname, answer: room._answers[pids[i]] };
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
    Object.values(room.players).forEach(function (p) { p.score += bonus; p.streak = (p.streak || 0) + 1; });
  } else {
    Object.values(room.players).forEach(function (p) { p.streak = 0; });
  }
  room.roundHistory.push({ question: q, answers: answers, bonus: bonus > 0 });
  var rid = getRoomId(room);
  io.to(rid).emit('round_result', { answers: answers, question: q, bonus: bonus > 0 });
  io.to(rid).emit('room_update', roomInfo(room, rid));
  if (room.apiKey) {
    try {
      var commentary = await generateAICommentary(q, answers, room.apiKey);
      io.to(rid).emit('ai_commentary', { text: commentary });
    } catch (e) { console.error('AI 点评失败:', e.message); }
  }
}

async function finishQuiz(room) {
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
    verdict: verdict.text + ' ' + verdict.emoji, emoji: verdict.emoji, history: room.roundHistory, mode: 'quiz',
  });
  io.to(rid).emit('room_update', roomInfo(room, rid));
  if (room.apiKey && room.roundHistory.length > 0) {
    try {
      var summary = await generateAISummary(room.roundHistory, room.players, room.apiKey);
      io.to(rid).emit('ai_summary', { text: summary });
    } catch (e) { console.error('AI 总结失败:', e.message); }
  }
}

// ===================== 工具 =====================
function getRoom(socket) {
  return rooms[socket.data ? socket.data.roomId : ''];
}

function getRoomId(room) {
  for (var rid in rooms) { if (rooms[rid] === room) return rid; }
  return '';
}

function roomInfo(room, rid) {
  return {
    roomId: rid,
    name: room.name,
    gameMode: room.gameMode,
    gameModeLabel: GAME_MODES[room.gameMode] ? GAME_MODES[room.gameMode].name : '',
    theme: room.theme,
    themeLabel: THEMES[room.theme] ? THEMES[room.theme].name : '',
    hasAI: !!(room.apiKey && room.theme === 'ai'),
    state: room.state,
    round: room.round,
    totalRounds: room.gameMode === 'story' ? STORY_ROUNDS : (room.gameMode === 'wishlist' ? WISHLIST_ROUNDS : TOTAL_ROUNDS),
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

// ===================== 情景扮演逻辑 =====================
function startRoleplay(room) {
  room.state = 'playing';
  room.round = 0;
  room.roleplayAnswers = {};
  room.roleplayScenarios = [];
  nextRoleplayRound(room);
}

function nextRoleplayRound(room) {
  room.round++;
  if (room.round > ROLEPLAY_ROUNDS) return finishRoleplay(room);
  room.roleplayAnswers = {};
  var available = ROLEPLAY_SCENARIOS.filter(function (s) { return !room.roleplayScenarios.some(function (u) { return u === s; }); });
  if (available.length === 0) { room.roleplayScenarios = []; available = ROLEPLAY_SCENARIOS; }
  var scenario = available[Math.floor(Math.random() * available.length)];
  room.roleplayScenarios.push(scenario);
  io.to(getRoomId(room)).emit('roleplay_round', {
    round: room.round, totalRounds: ROLEPLAY_ROUNDS, scenario: scenario,
  });
}

function revealRoleplay(room) {
  var pids = Object.keys(room.players);
  var items = [];
  for (var i = 0; i < pids.length; i++) {
    items.push({ nickname: room.players[pids[i]].nickname, text: room.roleplayAnswers[pids[i]] });
  }
  io.to(getRoomId(room)).emit('roleplay_reveal', {
    round: room.round, totalRounds: ROLEPLAY_ROUNDS,
    scenario: room.roleplayScenarios[room.roleplayScenarios.length - 1],
    items: items,
  });
}

function finishRoleplay(room) {
  room.state = 'finished';
  var rid = getRoomId(room);
  io.to(rid).emit('roleplay_finished', {});
  io.to(rid).emit('room_update', roomInfo(room, rid));
}

// ===================== 你画我猜逻辑 =====================
function startDraw(room) {
  room.state = 'playing';
  room.drawRound = 0;
  room.drawWords = [];
  room._guessCorrect = false;
  Object.values(room.players).forEach(function (p) { p.score = 0; });
  startDrawRound(room);
}

function startDrawRound(room) {
  room.drawRound++;
  if (room.drawRound > DRAW_ROUNDS) return finishDraw(room);
  room._answers = {};
  var available = DRAW_WORDS.filter(function (w) { return !room.drawWords.some(function (u) { return u === w; }); });
  if (available.length === 0) { room.drawWords = []; available = DRAW_WORDS; }
  room.drawWord = available[Math.floor(Math.random() * available.length)];
  room.drawWords.push(room.drawWord);
  var pids = Object.keys(room.players);
  // 轮流画
  room.drawDrawer = pids[(room.drawRound - 1) % 2];
  var drawerName = room.players[room.drawDrawer].nickname;
  io.to(getRoomId(room)).emit('draw_round', {
    round: room.drawRound,
    totalRounds: DRAW_ROUNDS,
    word: room.drawWord,
    drawerId: room.drawDrawer,
    drawerName: drawerName,
  });
}

function finishDraw(room) {
  room.state = 'finished';
  var rid = getRoomId(room);
  var sorted = Object.values(room.players).sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
  io.to(rid).emit('draw_finished', {
    players: sorted.map(function (p) { return { nickname: p.nickname, score: p.score || 0 }; }),
  });
  io.to(rid).emit('room_update', roomInfo(room, rid));
}

// ===================== 谁是卧底逻辑 =====================
function startSpy(room) {
  room.state = 'playing';
  room.spyRound = 0;
  room.spyDescriptions = [];
  room._answers = {};
  var pair = SPY_PAIRS[Math.floor(Math.random() * SPY_PAIRS.length)];
  room.spyPair = pair;
  var pids = Object.keys(room.players);
  // Randomly assign which word goes to whom
  if (Math.random() < 0.5) {
    room.spyWordA = pair[0]; room.spyWordB = pair[1];
  } else {
    room.spyWordA = pair[1]; room.spyWordB = pair[0];
  }
  var firstPid = pids[0];
  var rid = getRoomId(room);
  // Send private words to each player
  io.to(pids[0]).emit('spy_start', { word: room.spyWordA, speakerFirst: pids[0] === firstPid, totalRounds: SPY_ROUNDS, round: 1, speakerId: firstPid, speakerName: esc(room.players[firstPid].nickname), descriptions: [] });
  io.to(pids[1]).emit('spy_start', { word: room.spyWordB, speakerFirst: pids[1] === firstPid, totalRounds: SPY_ROUNDS, round: 1, speakerId: firstPid, speakerName: esc(room.players[firstPid].nickname), descriptions: [] });
}

function revealSpy(room) {
  var rid = getRoomId(room);
  io.to(rid).emit('spy_reveal', {
    descriptions: room.spyDescriptions,
    pair: room.spyPair,
  });
}

function finishSpy(room) {
  room.state = 'finished';
  var rid = getRoomId(room);
  var pids = Object.keys(room.players);
  var results = [];
  for (var i = 0; i < pids.length; i++) {
    var pid = pids[i];
    var otherPid = pids[1 - i];
    var correct = room._answers[pid] && room._answers[pid] === (i === 0 ? room.spyWordB : room.spyWordA);
    results.push({ nickname: esc(room.players[pid].nickname), guess: room._answers[pid] || '', correct: correct });
  }
  io.to(rid).emit('spy_finished', {
    pair: room.spyPair,
    words: {
      [room.players[pids[0]].nickname]: room.spyWordA,
      [room.players[pids[1]].nickname]: room.spyWordB,
    },
    results: results,
  });
  io.to(rid).emit('room_update', roomInfo(room, rid));
}

// ===================== 真假日常逻辑 =====================
function startTruthLie(room) {
  room.state = 'playing';
  room.truthlieSet = [];
  room.truthlieRound = 0;
  room.round = 0;
  room._answers = {};
  io.to(getRoomId(room)).emit('truthlie_round', { round: 1, totalRounds: TRUTHLIE_ROUNDS });
}

function revealTruthLie(room, phase) {
  var rid = getRoomId(room);
  var pids = Object.keys(room.players);
  if (phase === 1) {
    // Each player picked which of their own items is the lie
    // Store the lie index
    for (var i = 0; i < room.truthlieSet.length; i++) {
      var set = room.truthlieSet[i];
      set.lieIdx = room._answers[set.playerId] || 0;
    }
    room._answers = {};
    // Now show each player the OTHER person's 3 items, ask them to guess the lie
    io.to(pids[0]).emit('truthlie_guess_phase', { items: room.truthlieSet.filter(function (s) { return s.playerId !== pids[0]; })[0] });
    io.to(pids[1]).emit('truthlie_guess_phase', { items: room.truthlieSet.filter(function (s) { return s.playerId !== pids[1]; })[0] });
  } else {
    // Both guessed - reveal
    var results = [];
    for (var j = 0; j < room.truthlieSet.length; j++) {
      var st = room.truthlieSet[j];
      var guesser = pids[1 - room.truthlieSet.findIndex(function (s) { return s.playerId === st.playerId; })];
      var guessIdx = room._answers[guesser] !== undefined ? room._answers[guesser] : -1;
      var gotIt = guessIdx === st.lieIdx;
      results.push({
        nickname: st.nickname,
        items: st.items,
        lieIdx: st.lieIdx,
        lieText: st.items[st.lieIdx],
        guesser: esc(room.players[guesser].nickname),
        guessIdx: guessIdx,
        correct: gotIt,
      });
    }
    io.to(rid).emit('truthlie_reveal', { results: results });
    room.round++;
    if (room.round >= TRUTHLIE_ROUNDS) {
      room.state = 'finished';
      io.to(rid).emit('truthlie_finished', { results: results });
      io.to(rid).emit('room_update', roomInfo(room, rid));
    }
  }
}

// ===================== 恋爱飞行棋逻辑 =====================
function startMonopoly(room) {
  room.state = 'playing';
  room.monopolySquares = genMonopolySquares();
  room.monopolyPos = {};
  room.monopolyTurns = 0;
  var pids = Object.keys(room.players);
  room.monopolyPos[pids[0]] = 0;
  room.monopolyPos[pids[1]] = 0;
  Object.values(room.players).forEach(function (p) { p.score = 0; });
  io.to(getRoomId(room)).emit('monopoly_start', {
    total: MONOPOLY_BOARD,
    firstPlayerId: pids[0],
    firstPlayerName: esc(room.players[pids[0]].nickname),
    players: [{
      id: pids[0], name: esc(room.players[pids[0]].nickname), pos: 0, color: '#ff6b9d',
    }, {
      id: pids[1], name: esc(room.players[pids[1]].nickname), pos: 0, color: '#7c5cfc',
    }],
  });
}

function finishMonopoly(room, winnerId) {
  room.state = 'finished';
  var rid = getRoomId(room);
  io.to(rid).emit('monopoly_finished', {
    winner: esc(room.players[winnerId].nickname),
  });
  io.to(rid).emit('room_update', roomInfo(room, rid));
}

var PORT = process.env.PORT || 7860;
server.listen(PORT, function () {
  console.log('💞 情侣小游戏 http://localhost:' + PORT);
});
