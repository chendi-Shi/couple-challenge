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
    body: JSON.stringify({ model: DEEPSEEK_MODEL, messages: messages, temperature: 0.9, max_tokens: maxTokens || 600 }),
  });
  if (!res.ok) { var err = await res.text(); throw new Error('DeepSeek error ' + res.status + ': ' + err); }
  var data = await res.json();
  return data.choices[0].message.content;
}

async function generateAIQuestion(apiKey) {
  var prompt = '你是一个情侣默契挑战的出题助手。请生成一道有趣的情侣默契题目。返回纯 JSON，不要 markdown 代码块：\n{"type":"choice或who或fill","q":"题目","options":["选项1"...],"category":"标签"}\n选择题 4 选项，who 题选项固定 ["我","TA"]，fill 题选项为空。要有新意。';
  var text = await callDeepSeek([{ role: 'system', content: '只返回纯 JSON。' }, { role: 'user', content: prompt }], apiKey, 400);
  var json = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(json);
}

async function generateAICommentary(question, answers, apiKey) {
  var list = Object.values(answers).map(function (a) { return a.nickname + '：' + a.answer; }).join('\n');
  var prompt = '题目：' + question.q + '\n\n回答：\n' + list + '\n\n用 2-3 句甜趣暖心点评。';
  return callDeepSeek([{ role: 'system', content: '温暖幽默的恋爱观察员。' }, { role: 'user', content: prompt }], apiKey, 250);
}

async function generateAISummary(history, players, apiKey) {
  var rounds = '';
  history.forEach(function (item, i) {
    rounds += '第' + (i + 1) + '题：' + item.question.q + '\n';
    Object.values(item.answers).forEach(function (a) { rounds += '  ' + a.nickname + '：' + a.answer + '\n'; });
  });
  var names = Object.values(players).map(function (p) { return p.nickname; }).join(' 和 ');
  return callDeepSeek([{ role: 'system', content: '温暖真诚的情感写作者。' }, { role: 'user', content: '玩家：' + names + '\n问答：\n' + rounds + '\n写 120 字暖心总结。' }], apiKey, 400);
}

// ===================== 游戏模式 =====================
var GAME_MODES = {
  quiz:     { name: '💞 默契挑战', desc: '答题测默契，看谁更懂谁', icon: '💞' },
  story:    { name: '📝 故事接龙', desc: '一人一句，编一个属于你们的故事', icon: '📝' },
  wishlist: { name: '📋 愿望清单', desc: '一起写想一起做的事，攒到见面', icon: '📋' },
  roleplay: { name: '🎭 情景扮演', desc: '给一个场景，各自写你会怎么做', icon: '🎭' },
  draw:     { name: '🎨 你画我猜', desc: '一个人画，另一个人猜是什么', icon: '🎨' },
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
    { type: 'fill',   q: '你最想和 TA 一起去的城市是哪里？', options: [] },
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

// ===================== 房间 =====================
var rooms = {};
var TOTAL_ROUNDS = 5;
var STORY_ROUNDS = 6;
var WISHLIST_ROUNDS = 5;
var ROLEPLAY_ROUNDS = 3;
var DRAW_ROUNDS = 4;

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
  return {
    name: roomName,
    players: {},
    gameMode: gameMode || 'quiz',
    theme: themeKey || 'random',
    apiKey: apiKey || '',
    round: 0,
    totalRounds: TOTAL_ROUNDS,
    state: 'waiting',
    questions: [],
    roundHistory: [],
    challengeInjected: false,
    // story
    storyLines: [],
    storyPrompt: '',
    // wishlist
    wishlistItems: [],
    wishlistPrompts: [],
    // roleplay
    roleplayScenarios: [],
    roleplayAnswers: {},
    // draw
    drawWords: [],
    drawRound: 0,
    drawWord: '',
    drawDrawer: '',
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
  var used = new Set(room.questions);
  var available = pool.filter(function (q, i) { return !used.has(room.theme + '_' + i); });
  if (available.length === 0) { room.questions = []; return pool[Math.floor(Math.random() * pool.length)]; }
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

    // quiz 模式
    room.questions = [];
    room.roundHistory = [];
    room.challengeInjected = false;
    room.totalRounds = TOTAL_ROUNDS;
    Object.values(room.players).forEach(function (p) { p.score = 0; p.streak = 0; });
    nextQuizRound(room);
  });

  // ====== 提交答案（quiz） ======
  socket.on('submit_answer', function (answer) {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing') return;
    if (room.gameMode !== 'quiz') return;
    room._answers = room._answers || {};
    room._answers[socket.id] = answer;
    io.to(socket.data.roomId).emit('player_answered', { playerId: socket.id, nickname: socket.data.nickname });
    if (Object.keys(room.players).every(function (pid) { return room._answers[pid]; })) {
      revealQuizRound(room);
    }
  });

  // ====== 下一题（quiz） ======
  socket.on('next_round', function () {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing') return;
    if (room.gameMode !== 'quiz') return;
    room._answers = {};
    nextQuizRound(room);
  });

  // ====== 故事接龙 - 提交一句 ======
  socket.on('submit_story_line', function (text) {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing' || room.gameMode !== 'story') return;
    var pids = Object.keys(room.players);
    var turnIdx = room.storyLines.length % 2;
    if (socket.id !== pids[turnIdx]) return; // 不是你的回合
    room.storyLines.push({ nickname: socket.data.nickname, text: text.trim() });
    room.round = room.storyLines.length;

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
        turnNickname: room.players[nextPid].nickname,
        lastNickname: socket.data.nickname,
      });
    }
  });

  // ====== 愿望清单 - 提交愿望 ======
  socket.on('submit_wish', function (text) {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing' || room.gameMode !== 'wishlist') return;
    room._answers = room._answers || {};
    room._answers[socket.id] = text.trim();
    io.to(socket.data.roomId).emit('player_answered', { playerId: socket.id, nickname: socket.data.nickname });

    if (Object.keys(room.players).every(function (pid) { return room._answers[pid]; })) {
      revealWishlistRound(room);
    }
  });

  // ====== 愿望清单 - 下一轮 ======
  socket.on('wishlist_next', function () {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing' || room.gameMode !== 'wishlist') return;
    room._answers = {};
    nextWishlistRound(room);
  });

  // ====== 情景扮演 - 提交 ======
  socket.on('submit_roleplay', function (text) {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing' || room.gameMode !== 'roleplay') return;
    room.roleplayAnswers = room.roleplayAnswers || {};
    room.roleplayAnswers[socket.id] = text.trim();
    io.to(socket.data.roomId).emit('player_answered', { playerId: socket.id, nickname: socket.data.nickname });
    if (Object.keys(room.players).every(function (pid) { return room.roleplayAnswers[pid]; })) {
      revealRoleplay(room);
    }
  });

  socket.on('roleplay_next', function () {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing' || room.gameMode !== 'roleplay') return;
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
    var correct = guess.trim() === room.drawWord;
    var rid = socket.data.roomId;
    if (correct) {
      // 猜对了
      var pids = Object.keys(room.players);
      var drawerPid = room.drawDrawer;
      var guesserPid = pids.find(function (pid) { return pid !== drawerPid; });
      if (guesserPid) room.players[guesserPid].score = (room.players[guesserPid].score || 0) + 1;
      io.to(rid).emit('guess_result', {
        correct: true, guess: guess.trim(),
        guesser: socket.data.nickname, word: room.drawWord,
      });
      io.to(rid).emit('room_update', roomInfo(room, rid));
    } else {
      io.to(rid).emit('guess_result', {
        correct: false, guess: guess.trim(),
        guesser: socket.data.nickname,
      });
    }
  });

  socket.on('draw_next', function () {
    var room = getRoom(socket);
    if (!room || room.state !== 'playing' || room.gameMode !== 'draw') return;
    room.drawRound++;
    if (room.drawRound > DRAW_ROUNDS) {
      finishDraw(room);
    } else {
      startDrawRound(room);
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
    Object.values(room.players).forEach(function (p) { p.score = 0; p.streak = 0; });
    io.to(socket.data.roomId).emit('room_update', roomInfo(room, socket.data.roomId));
  });

  // ====== 断开 ======
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
  Object.values(room.players).forEach(function (p) { p.score = 0; });
  room.drawRound = 0;
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

var PORT = process.env.PORT || 7860;
server.listen(PORT, function () {
  console.log('💞 情侣小游戏 http://localhost:' + PORT);
});
