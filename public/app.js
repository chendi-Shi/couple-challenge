var socket = io();

var myNickname = '';
var roomId = '';
var myScore = 0;
var partnerScore = 0;
var selectedTheme = 'random';

// ====== DOM helpers ======
function $(s) { return document.querySelector(s); }
function $$(s) { return document.querySelectorAll(s); }

function showScreen(name) {
  $$('.screen').forEach(function (s) { s.classList.remove('active'); });
  $('#' + name).classList.add('active');
}

function toast(msg) {
  var el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(function () { el.classList.remove('show'); }, 2500);
}

// ====== 主题定义（与服务端对应）=====
var THEMES = [
  { key: 'random',   icon: '🎲', name: '随机混搭',  desc: '各种题型随机，每次惊喜' },
  { key: 'food',     icon: '🍜', name: '美食',      desc: '关于吃的甜蜜默契' },
  { key: 'travel',   icon: '✈️', name: '旅行',      desc: '想象一起出行的场景' },
  { key: 'love',     icon: '💕', name: '恋爱',      desc: '关于我们之间那些事' },
  { key: 'daily',    icon: '🏠', name: '日常',      desc: '宅在一起的日常想象' },
  { key: 'deeptalk', icon: '💬', name: '真心话',    desc: '走心的问题，更了解彼此' },
  { key: 'ai',       icon: '🤖', name: 'AI 智能出题', desc: 'DeepSeek 实时生成，永不重复' },
];

// ====== 渲染主题选择器 ======
(function renderThemePicker() {
  var grid = $('#theme-picker');
  THEMES.forEach(function (t) {
    var div = document.createElement('div');
    div.className = 'theme-option' + (t.key === 'random' ? ' selected' : '');
    div.setAttribute('data-key', t.key);
    div.innerHTML = '<span class="theme-icon">' + t.icon + '</span>' +
      '<span class="theme-name">' + t.name + '</span>' +
      '<span class="theme-desc">' + t.desc + '</span>';
    div.addEventListener('click', function () {
      $$('.theme-option').forEach(function (o) { o.classList.remove('selected'); });
      div.classList.add('selected');
      selectedTheme = t.key;
      // AI 主题时显示 API Key 输入框
      $('#api-key-group').style.display = selectedTheme === 'ai' ? 'flex' : 'none';
    });
    grid.appendChild(div);
  });
})();

// ====== Tab 切换 ======
$$('.tab').forEach(function (tab) {
  tab.addEventListener('click', function () {
    $$('.tab').forEach(function (t) { t.classList.remove('active'); });
    $$('.tab-content').forEach(function (c) { c.classList.remove('active'); });
    tab.classList.add('active');
    $('#tab-' + tab.dataset.tab).classList.add('active');
  });
});

// ====== 创建房间 ======
$('#btn-create').addEventListener('click', function () {
  var nickname = $('#create-nickname').value.trim();
  var roomName = $('#room-name').value.trim() || '甜蜜小屋';
  if (!nickname) return toast('请输入昵称');

  // AI 主题需要 API Key
  if (selectedTheme === 'ai') {
    var apiKey = $('#api-key-input').value.trim();
    if (!apiKey) return toast('选择 AI 主题需要填写 DeepSeek API Key');
  }

  myNickname = nickname;
  var apiKeyVal = $('#api-key-input').value.trim();
  socket.emit('create_room', {
    roomName: roomName,
    nickname: nickname,
    theme: selectedTheme,
    apiKey: apiKeyVal,
  }, function (res) {
    if (res.ok) {
      roomId = res.roomId;
      updateWaiting(res.room);
      showScreen('waiting');
    }
  });
});

// ====== 加入房间 ======
$('#btn-join').addEventListener('click', function () {
  var rid = $('#join-room-id').value.trim().toUpperCase();
  var nickname = $('#join-nickname').value.trim();
  if (!rid) return toast('请输入房间码');
  if (!nickname) return toast('请输入昵称');
  myNickname = nickname;
  socket.emit('join_room', { roomId: rid, nickname: nickname }, function (res) {
    if (!res.ok) return toast(res.error);
    roomId = res.roomId;
    updateWaiting(res.room);
    showScreen('waiting');
  });
});

// ====== 开始游戏 ======
$('#btn-start').addEventListener('click', function () {
  socket.emit('start_game');
});

// ====== 提交选择题 ======
function selectOption(opt, el) {
  if (el.classList.contains('selected')) return;
  $$('.option-btn').forEach(function (b) { b.classList.remove('selected'); });
  el.classList.add('selected');
  socket.emit('submit_answer', opt);
  $('#status-me').textContent = '👤 你：已提交';
  $('#status-me').classList.add('done');
  $$('.option-btn').forEach(function (b) { b.style.pointerEvents = 'none'; });
}

// ====== 提交填空题 ======
$('#btn-submit-fill').addEventListener('click', function () {
  var val = $('#fill-input').value.trim();
  if (!val) return toast('写点什么吧～');
  socket.emit('submit_answer', val);
  $('#btn-submit-fill').disabled = true;
  $('#fill-input').disabled = true;
  $('#status-me').textContent = '👤 你：已提交';
  $('#status-me').classList.add('done');
});

// ====== 下一题 ======
$('#btn-next').addEventListener('click', function () {
  socket.emit('next_round');
});

// ====== 再玩一局 / 返回 ======
$('#btn-again').addEventListener('click', function () {
  socket.emit('play_again');
  $('#review-list').innerHTML = '';
  $('#ai-summary').style.display = 'none';
  showScreen('waiting');
});

$('#btn-back').addEventListener('click', function () {
  location.reload();
});

// ==================== Socket 事件 ====================

socket.on('room_update', function (room) {
  updateWaiting(room);
});

socket.on('new_round', function (data) {
  showScreen('playing');
  $('#ai-commentary').style.display = 'none';
  $('#round-num').textContent = data.round;
  $('#round-total').textContent = data.totalRounds;

  var q = data.question;
  $('#round-cat').textContent = q.category || '';
  $('#question-text').textContent = q.q;

  var labelMap = { who: '谁更可能...', choice: '默契选择', fill: '默契问答', challenge: '⚡ 小挑战' };
  $('#question-label').textContent = labelMap[q.type] || '默契问答';

  $('#challenge-emoji').style.display = q.emoji ? 'block' : 'none';
  if (q.emoji) $('#challenge-emoji').textContent = q.emoji;

  // 重置状态
  $('#status-me').textContent = '👤 你：等待中';
  $('#status-me').classList.remove('done');
  $('#status-partner').textContent = '❤️ TA：等待中';
  $('#status-partner').classList.remove('done');
  $('#btn-submit-fill').disabled = false;
  $('#fill-input').disabled = false;
  $('#fill-input').value = '';

  // 渲染选项
  if (q.type === 'fill') {
    $('#choice-options').style.display = 'none';
    $('#fill-answer').style.display = 'flex';
  } else {
    $('#choice-options').style.display = 'flex';
    $('#fill-answer').style.display = 'none';
    var grid = $('#choice-options');
    grid.innerHTML = '';
    (q.options || []).forEach(function (opt) {
      var btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.textContent = opt;
      btn.addEventListener('click', function () { selectOption(opt, btn); });
      grid.appendChild(btn);
    });
  }
});

// 对方提交
socket.on('player_answered', function (data) {
  if (data.playerId === socket.id) return;
  $('#status-partner').textContent = '❤️ TA：已提交';
  $('#status-partner').classList.add('done');
});

// 揭晓结果
socket.on('round_result', function (data) {
  showScreen('result');

  // 隐藏上一轮的 AI 点评
  $('#ai-commentary').style.display = 'none';

  var iconEl = $('#result-icon');
  var textEl = $('#result-text');

  if (data.bonus) {
    iconEl.textContent = '💕';
    textEl.textContent = '默契 +1！心有灵犀';
    spawnConfetti();
  } else if (data.question.type === 'challenge') {
    iconEl.textContent = '😂';
    textEl.textContent = '不管谁快，你们都完成了挑战！';
  } else if (data.question.type === 'fill') {
    iconEl.textContent = '💭';
    textEl.textContent = '看看 TA 写下了什么～';
  } else {
    iconEl.textContent = '🤔';
    textEl.textContent = '想法不太一样，也是一种默契～';
  }

  var playerIds = Object.keys(data.answers);
  if (playerIds.length >= 1) {
    $('#result-nickname1').textContent = data.answers[playerIds[0]].nickname;
    $('#result-answer1').textContent = data.answers[playerIds[0]].answer;
  }
  if (playerIds.length >= 2) {
    $('#result-nickname2').textContent = data.answers[playerIds[1]].nickname;
    $('#result-answer2').textContent = data.answers[playerIds[1]].answer;
  }
});

// AI 点评（异步到达）
socket.on('ai_commentary', function (data) {
  $('#ai-commentary').style.display = 'block';
  $('#ai-commentary-text').textContent = data.text;
});

// AI 总结（异步到达）
socket.on('ai_summary', function (data) {
  $('#ai-summary').style.display = 'block';
  $('#ai-summary-text').textContent = data.text;
});

// 游戏结束
socket.on('game_finished', function (data) {
  showScreen('finished');
  $('#verdict-text').textContent = data.verdict;
  if (data.emoji) $('#finish-emoji').textContent = data.emoji;

  // 计分板
  var board = $('#score-board');
  board.innerHTML = data.players.map(function (p, i) {
    var crown = i === 0 ? '🏆 ' : '';
    return '<div class="score-row"><span class="name">' + crown + p.nickname + '</span><span class="score">' + p.score + ' 分</span></div>';
  }).join('');

  // 回顾
  renderReview(data.history || []);

  spawnConfetti();
});

// 对方离开
socket.on('partner_left', function () {
  toast('TA 离开了房间 😢');
  showScreen('lobby');
});

// ====== 回顾渲染 ======
function renderReview(history) {
  var list = $('#review-list');
  list.innerHTML = '';
  history.forEach(function (item) {
    var playerIds = Object.keys(item.answers);
    var badge = item.bonus
      ? '<span class="rev-badge match">💕 默契</span>'
      : '<span class="rev-badge miss">不一样</span>';

    var answersHtml = '';
    playerIds.forEach(function (pid) {
      answersHtml += '<div class="rev-a"><div class="rev-nick">' +
        item.answers[pid].nickname +
        '</div><div class="rev-ans">' + item.answers[pid].answer + '</div></div>';
    });

    list.innerHTML += '<div class="review-item"><div class="rev-q">' + badge + ' ' +
      item.question.q + '</div><div class="rev-answers">' + answersHtml + '</div></div>';
  });
}

// ====== 等待室更新 ======
function updateWaiting(room) {
  if (room.state !== 'waiting') return;
  var players = Object.values(room.players);

  $('#waiting-room-id').textContent = room.roomId;
  $('#waiting-room-name').textContent = room.name;
  $('#waiting-theme-tag').textContent = room.themeLabel || '随机混搭';

  if (players.length >= 1) {
    $('#waiting-player1').textContent = players[0].nickname;
    $('#player-card-host').classList.add('filled');
  }
  if (players.length >= 2) {
    $('#waiting-player2').textContent = players[1].nickname;
    $('#player-card-guest').classList.remove('empty');
    $('#player-card-guest').classList.add('filled');
    $('#btn-start').disabled = false;
    $('#btn-start').textContent = '开始挑战！';
  } else {
    $('#player-card-guest').classList.add('empty');
    $('#player-card-guest').classList.remove('filled');
    $('#waiting-player2').textContent = '等待中...';
    $('#btn-start').disabled = true;
    $('#btn-start').textContent = '等待 TA 加入...';
  }
}

// ====== 庆祝彩带 ======
function spawnConfetti() {
  var container = $('#confetti-container');
  var colors = ['#ff6b9d', '#7c5cfc', '#ffb300', '#4caf50', '#ff9800', '#00bcd4', '#e91e63'];
  var emojis = ['💕', '✨', '💖', '🌟', '💝', '🎉', '💞', '💗'];

  var fragment = document.createDocumentFragment();
  for (var i = 0; i < 40; i++) {
    var piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + '%';
    piece.style.top = -(Math.random() * 20) + 'px';
    piece.style.animationDelay = Math.random() * 0.8 + 's';
    piece.style.animationDuration = (1.5 + Math.random() * 2) + 's';
    piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    piece.style.width = (8 + Math.random() * 14) + 'px';
    piece.style.height = (8 + Math.random() * 14) + 'px';
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '3px';
    if (Math.random() > 0.7) {
      piece.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      piece.style.fontSize = '16px';
      piece.style.backgroundColor = 'transparent';
    }
    fragment.appendChild(piece);
  }
  container.innerHTML = '';
  container.appendChild(fragment);

  setTimeout(function () { container.innerHTML = ''; }, 3000);
}

// ====== 回车快捷键 ======
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Enter') return;
  if ($('#lobby').classList.contains('active')) {
    if ($('#tab-create').classList.contains('active')) {
      $('#btn-create').click();
    } else {
      $('#btn-join').click();
    }
  }
  if ($('#playing').classList.contains('active') && $('#fill-answer').style.display !== 'none') {
    $('#btn-submit-fill').click();
  }
  if ($('#result').classList.contains('active')) {
    $('#btn-next').click();
  }
});
