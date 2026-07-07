var socket = io();
var myNickname = '', roomId = '', myRole = '';
var selectedGame = 'quiz', selectedTheme = 'random';

function $(s) { return document.querySelector(s); }
function $$(s) { return document.querySelectorAll(s); }
function show(name) { $$('.screen').forEach(function (s) { s.classList.remove('active'); }); $('#' + name).classList.add('active'); }
function toast(m) { var e = $('#toast'); e.textContent = m; e.classList.add('show'); setTimeout(function () { e.classList.remove('show'); }, 2500); }

var GAME_MODES = [
  { key: 'quiz',     icon: '💞', name: '默契挑战', desc: '答题测默契' },
  { key: 'story',    icon: '📝', name: '故事接龙', desc: '一人一句编故事' },
  { key: 'wishlist', icon: '📋', name: '愿望清单', desc: '写下想一起做的事' },
  { key: 'roleplay', icon: '🎭', name: '情景扮演', desc: '给场景各自演一段' },
  { key: 'draw',     icon: '🎨', name: '你画我猜', desc: '一人画一人猜' },
];

var THEMES = [
  { key: 'random',   icon: '🎲', name: '随机混搭', desc: '各种题型随机' },
  { key: 'food',     icon: '🍜', name: '美食',     desc: '关于吃的默契' },
  { key: 'travel',   icon: '✈️', name: '旅行',     desc: '想象一起出行' },
  { key: 'love',     icon: '💕', name: '恋爱',     desc: '我们之间的事' },
  { key: 'daily',    icon: '🏠', name: '日常',     desc: '宅家想象' },
  { key: 'deeptalk', icon: '💬', name: '真心话',   desc: '走心问题' },
  { key: 'ai',       icon: '🤖', name: 'AI 出题',  desc: 'DeepSeek 生成' },
];

// Render game mode picker
(function () {
  var g = $('#game-mode-picker');
  GAME_MODES.forEach(function (m) {
    var d = document.createElement('div');
    d.className = 'game-mode-option' + (m.key === 'quiz' ? ' selected' : '');
    d.setAttribute('data-key', m.key);
    d.innerHTML = '<span class="gm-icon">' + m.icon + '</span><span class="gm-name">' + m.name + '</span><span class="gm-desc">' + m.desc + '</span>';
    d.addEventListener('click', function () {
      $$('.game-mode-option').forEach(function (o) { o.classList.remove('selected'); });
      d.classList.add('selected');
      selectedGame = m.key;
      $('#quiz-theme-area').style.display = selectedGame === 'quiz' ? 'block' : 'none';
      if (selectedGame !== 'quiz') { $('#api-key-group').style.display = 'none'; }
    });
    g.appendChild(d);
  });
})();

// Render theme picker
(function () {
  var g = $('#theme-picker');
  THEMES.forEach(function (t) {
    var d = document.createElement('div');
    d.className = 'theme-option' + (t.key === 'random' ? ' selected' : '');
    d.setAttribute('data-key', t.key);
    d.innerHTML = '<span class="theme-icon">' + t.icon + '</span><span class="theme-name">' + t.name + '</span><span class="theme-desc">' + t.desc + '</span>';
    d.addEventListener('click', function () {
      $$('.theme-option').forEach(function (o) { o.classList.remove('selected'); });
      d.classList.add('selected');
      selectedTheme = t.key;
      $('#api-key-group').style.display = selectedTheme === 'ai' ? 'flex' : 'none';
    });
    g.appendChild(d);
  });
})();

// Tabs
$$('.tab').forEach(function (t) {
  t.addEventListener('click', function () {
    $$('.tab').forEach(function (x) { x.classList.remove('active'); });
    $$('.tab-content').forEach(function (x) { x.classList.remove('active'); });
    t.classList.add('active');
    $('#tab-' + t.dataset.tab).classList.add('active');
  });
});

// Create room
$('#btn-create').addEventListener('click', function () {
  var n = $('#create-nickname').value.trim();
  var rn = $('#room-name').value.trim() || '甜蜜小屋';
  if (!n) return toast('请输入昵称');
  if (selectedGame === 'quiz' && selectedTheme === 'ai' && !$('#api-key-input').value.trim()) return toast('AI 主题需要 API Key');
  myNickname = n;
  socket.emit('create_room', {
    roomName: rn, nickname: n, gameMode: selectedGame,
    theme: selectedTheme, apiKey: $('#api-key-input').value.trim(),
  }, function (res) {
    if (res.ok) { roomId = res.roomId; myRole = 'host'; updateWaiting(res.room); show('waiting'); }
  });
});

// Join room
$('#btn-join').addEventListener('click', function () {
  var rid = $('#join-room-id').value.trim().toUpperCase();
  var n = $('#join-nickname').value.trim();
  if (!rid) return toast('请输入房间码');
  if (!n) return toast('请输入昵称');
  myNickname = n;
  socket.emit('join_room', { roomId: rid, nickname: n }, function (res) {
    if (!res.ok) return toast(res.error);
    roomId = res.roomId; myRole = 'guest'; updateWaiting(res.room); show('waiting');
  });
});

// Start
$('#btn-start').addEventListener('click', function () { socket.emit('start_game'); });
function goLobby() { socket.emit('play_again'); show('lobby'); }

// ==================== Quiz ====================
function selectOption(opt, el) {
  if (el.classList.contains('selected')) return;
  $$('.option-btn').forEach(function (b) { b.classList.remove('selected'); });
  el.classList.add('selected');
  socket.emit('submit_answer', opt);
  $('#status-me').textContent = '👤 你：已提交'; $('#status-me').classList.add('done');
  $$('.option-btn').forEach(function (b) { b.style.pointerEvents = 'none'; });
}
$('#btn-submit-fill').addEventListener('click', function () {
  var v = $('#fill-input').value.trim();
  if (!v) return toast('写点什么吧～');
  socket.emit('submit_answer', v);
  $('#btn-submit-fill').disabled = true; $('#fill-input').disabled = true;
  $('#status-me').textContent = '👤 你：已提交'; $('#status-me').classList.add('done');
});
$('#btn-next-quiz').addEventListener('click', function () { socket.emit('next_round'); });
$('#btn-again-quiz').addEventListener('click', function () { socket.emit('play_again'); show('waiting'); });
$('#btn-back-quiz').addEventListener('click', goLobby);

// ==================== Story ====================
$('#btn-submit-story').addEventListener('click', function () {
  var v = $('#story-input').value.trim();
  if (!v) return toast('写下你的句子吧～');
  socket.emit('submit_story_line', v);
});
$('#btn-again-story').addEventListener('click', function () { socket.emit('play_again'); show('waiting'); });
$('#btn-back-story').addEventListener('click', goLobby);

// ==================== Wishlist ====================
$('#btn-submit-wish').addEventListener('click', function () {
  var v = $('#wl-input').value.trim();
  if (!v) return toast('写下你的愿望吧～');
  socket.emit('submit_wish', v);
  $('#btn-submit-wish').disabled = true; $('#wl-input').disabled = true;
  $('#wl-status-me').textContent = '👤 你：已提交'; $('#wl-status-me').classList.add('done');
});
$('#btn-next-wish').addEventListener('click', function () { socket.emit('wishlist_next'); });
$('#btn-again-wish').addEventListener('click', function () { socket.emit('play_again'); show('waiting'); });
$('#btn-back-wish').addEventListener('click', goLobby);

// ==================== Roleplay ====================
$('#btn-submit-rp').addEventListener('click', function () {
  var v = $('#rp-input').value.trim();
  if (!v) return toast('写下你会怎么做吧～');
  socket.emit('submit_roleplay', v);
  $('#btn-submit-rp').disabled = true; $('#rp-input').disabled = true;
  $('#rp-status-me').textContent = '👤 你：已提交'; $('#rp-status-me').classList.add('done');
});
$('#btn-next-rp').addEventListener('click', function () { socket.emit('roleplay_next'); });
$('#btn-again-rp').addEventListener('click', function () { socket.emit('play_again'); show('waiting'); });
$('#btn-back-rp').addEventListener('click', goLobby);

// ==================== Draw ====================
var drawColor = '#333';
var drawCanvas = $('#draw-canvas');
var drawCtx = null;
var isDrawing = false;
var isDrawer = false;

function initCanvas() {
  if (!drawCanvas) return;
  drawCtx = drawCanvas.getContext('2d');
  drawCtx.lineWidth = 3; drawCtx.lineCap = 'round'; drawCtx.strokeStyle = drawColor;

  drawCanvas.addEventListener('mousedown', function (e) {
    if (!isDrawer) return; isDrawing = true; drawCtx.beginPath();
    var r = drawCanvas.getBoundingClientRect();
    var x = e.clientX - r.left, y = e.clientY - r.top;
    drawCtx.moveTo(x, y);
    socket.emit('draw_line', { x: x, y: y, color: drawColor, isStart: true });
  });
  drawCanvas.addEventListener('mousemove', function (e) {
    if (!isDrawing || !isDrawer) return;
    var r = drawCanvas.getBoundingClientRect();
    var x = e.clientX - r.left, y = e.clientY - r.top;
    drawCtx.lineTo(x, y); drawCtx.stroke();
    socket.emit('draw_line', { x: x, y: y, color: drawColor, isStart: false });
  });
  drawCanvas.addEventListener('mouseup', function () { isDrawing = false; });
  drawCanvas.addEventListener('mouseleave', function () { isDrawing = false; });

  drawCanvas.addEventListener('touchstart', function (e) {
    if (!isDrawer) return; e.preventDefault(); isDrawing = true; drawCtx.beginPath();
    var r = drawCanvas.getBoundingClientRect(); var t = e.touches[0];
    var x = t.clientX - r.left, y = t.clientY - r.top;
    drawCtx.moveTo(x, y);
    socket.emit('draw_line', { x: x, y: y, color: drawColor, isStart: true });
  });
  drawCanvas.addEventListener('touchmove', function (e) {
    if (!isDrawing || !isDrawer) return; e.preventDefault();
    var r = drawCanvas.getBoundingClientRect(); var t = e.touches[0];
    var x = t.clientX - r.left, y = t.clientY - r.top;
    drawCtx.lineTo(x, y); drawCtx.stroke();
    socket.emit('draw_line', { x: x, y: y, color: drawColor, isStart: false });
  });
  drawCanvas.addEventListener('touchend', function () { isDrawing = false; });
}

initCanvas();

$('#btn-black').addEventListener('click', function () { drawColor = '#333'; if (drawCtx) drawCtx.strokeStyle = drawColor; });
$('#btn-red').addEventListener('click', function () { drawColor = '#ff6b9d'; if (drawCtx) drawCtx.strokeStyle = drawColor; });
$('#btn-blue').addEventListener('click', function () { drawColor = '#7c5cfc'; if (drawCtx) drawCtx.strokeStyle = drawColor; });
$('#btn-green').addEventListener('click', function () { drawColor = '#4caf50'; if (drawCtx) drawCtx.strokeStyle = drawColor; });
$('#btn-orange').addEventListener('click', function () { drawColor = '#ffb300'; if (drawCtx) drawCtx.strokeStyle = drawColor; });

$('#btn-clear').addEventListener('click', function () {
  if (!drawCtx || !isDrawer) return;
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  socket.emit('draw_clear');
});
$('#btn-submit-guess').addEventListener('click', function () {
  var v = $('#guess-input').value.trim();
  if (!v) return;
  socket.emit('submit_guess', v);
  $('#guess-input').value = '';
});
$('#btn-next-dr').addEventListener('click', function () {
  socket.emit('draw_next');
  if (isDrawer && drawCtx) drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
});
$('#btn-again-dr').addEventListener('click', function () { socket.emit('play_again'); show('waiting'); });
$('#btn-back-dr').addEventListener('click', goLobby);

// ==================== Socket Events ====================

socket.on('room_update', function (room) { updateWaiting(room); });

// --- Quiz ---
socket.on('new_round', function (data) {
  show('quiz-playing');
  $('#ai-commentary').style.display = 'none';
  $('#round-num').textContent = data.round; $('#round-total').textContent = data.totalRounds;
  var q = data.question; $('#round-cat').textContent = q.category || ''; $('#question-text').textContent = q.q;
  var lm = { who: '谁更可能...', choice: '默契选择', fill: '默契问答', challenge: '⚡ 小挑战' };
  $('#question-label').textContent = lm[q.type] || '默契问答';
  $('#challenge-emoji').style.display = q.emoji ? 'block' : 'none';
  if (q.emoji) $('#challenge-emoji').textContent = q.emoji;
  $('#status-me').textContent = '👤 你：等待中'; $('#status-me').classList.remove('done');
  $('#status-partner').textContent = '❤️ TA：等待中'; $('#status-partner').classList.remove('done');
  $('#btn-submit-fill').disabled = false; $('#fill-input').disabled = false; $('#fill-input').value = '';
  if (q.type === 'fill') { $('#choice-options').style.display = 'none'; $('#fill-answer').style.display = 'flex'; }
  else {
    $('#choice-options').style.display = 'flex'; $('#fill-answer').style.display = 'none';
    var grid = $('#choice-options'); grid.innerHTML = '';
    (q.options || []).forEach(function (o) {
      var b = document.createElement('button'); b.className = 'option-btn'; b.textContent = o;
      b.addEventListener('click', function () { selectOption(o, b); });
      grid.appendChild(b);
    });
  }
});

socket.on('player_answered', function (d) {
  if (d.playerId === socket.id) return;
  if ($('#quiz-playing').classList.contains('active')) { $('#status-partner').textContent = '❤️ TA：已提交'; $('#status-partner').classList.add('done'); }
  if ($('#wishlist-playing').classList.contains('active')) { $('#wl-status-partner').textContent = '❤️ TA：已提交'; $('#wl-status-partner').classList.add('done'); }
  if ($('#roleplay-playing').classList.contains('active')) { $('#rp-status-partner').textContent = '❤️ TA：已提交'; $('#rp-status-partner').classList.add('done'); }
});

socket.on('round_result', function (data) {
  show('quiz-result');
  $('#ai-commentary').style.display = 'none';
  var icon = $('#result-icon'), text = $('#result-text');
  if (data.bonus) { icon.textContent = '💕'; text.textContent = '默契 +1！心有灵犀'; spawnConfetti(); }
  else if (data.question.type === 'challenge') { icon.textContent = '😂'; text.textContent = '不管怎样，你们完成了挑战！'; }
  else if (data.question.type === 'fill') { icon.textContent = '💭'; text.textContent = '看看 TA 写下了什么～'; }
  else { icon.textContent = '🤔'; text.textContent = '想法不一样，也是一种默契～'; }
  var pids = Object.keys(data.answers);
  if (pids.length >= 1) { $('#result-nickname1').textContent = data.answers[pids[0]].nickname; $('#result-answer1').textContent = data.answers[pids[0]].answer; }
  if (pids.length >= 2) { $('#result-nickname2').textContent = data.answers[pids[1]].nickname; $('#result-answer2').textContent = data.answers[pids[1]].answer; }
});

socket.on('ai_commentary', function (d) { $('#ai-commentary').style.display = 'block'; $('#ai-commentary-text').textContent = d.text; });
socket.on('ai_summary', function (d) { $('#ai-summary').style.display = 'block'; $('#ai-summary-text').textContent = d.text; });

socket.on('game_finished', function (data) {
  if (data.mode !== 'quiz') return;
  show('quiz-finished');
  $('#verdict-text').textContent = data.verdict; if (data.emoji) $('#finish-emoji').textContent = data.emoji;
  $('#score-board').innerHTML = data.players.map(function (p, i) {
    return '<div class="score-row"><span class="name">' + (i === 0 ? '🏆 ' : '') + p.nickname + '</span><span class="score">' + p.score + ' 分</span></div>';
  }).join('');
  renderReview(data.history || []); spawnConfetti();
});

function renderReview(h) {
  var l = $('#review-list'); l.innerHTML = '';
  h.forEach(function (item) {
    var badge = item.bonus ? '<span class="rev-badge match">💕 默契</span>' : '<span class="rev-badge miss">不一样</span>';
    var a = ''; Object.keys(item.answers).forEach(function (pid) {
      a += '<div class="rev-a"><div class="rev-nick">' + item.answers[pid].nickname + '</div><div class="rev-ans">' + item.answers[pid].answer + '</div></div>';
    });
    l.innerHTML += '<div class="review-item"><div class="rev-q">' + badge + ' ' + item.question.q + '</div><div class="rev-answers">' + a + '</div></div>';
  });
}

// --- Story ---
socket.on('story_update', function (data) {
  show('story-playing');
  $('#story-prompt-text').textContent = data.prompt;
  $('#story-round').textContent = data.currentRound; $('#story-total').textContent = data.totalRounds;
  $('#story-lines').innerHTML = data.lines.map(function (l) {
    return '<div class="story-line"><span class="story-author">' + l.nickname + '</span><span class="story-content">' + l.text + '</span></div>';
  }).join('');
  $('#story-scroll').scrollTop = $('#story-scroll').scrollHeight;
  var myTurn = data.turnPlayerId === socket.id;
  if (myTurn) {
    $('#story-input').disabled = false; $('#btn-submit-story').disabled = false;
    $('#story-input').value = ''; $('#story-input').focus();
    $('#story-turn-hint').innerHTML = '✏️ <b>该你写了！</b>';
    $('#story-input').style.display = 'block'; $('#btn-submit-story').style.display = 'block';
    $('#story-waiting').style.display = 'none';
  } else {
    $('#story-input').disabled = true; $('#btn-submit-story').disabled = true;
    $('#story-turn-hint').innerHTML = '⏳ 等待 <b>' + (data.turnNickname || 'TA') + '</b> 写下一句...';
    $('#story-input').style.display = 'none'; $('#btn-submit-story').style.display = 'none';
    $('#story-waiting').style.display = 'block';
  }
});

socket.on('story_finished', function (data) {
  show('story-finished');
  $('#story-full').innerHTML = '<div class="story-full-prompt">' + data.prompt + '</div>' +
    data.lines.map(function (l) { return '<div class="story-line"><span class="story-author">' + l.nickname + '</span><span class="story-content">' + l.text + '</span></div>'; }).join('');
  spawnConfetti();
});

// --- Wishlist ---
socket.on('wishlist_round', function (data) {
  show('wishlist-playing');
  $('#wl-round').textContent = data.round; $('#wl-total').textContent = data.totalRounds;
  $('#wl-prompt-text').textContent = data.prompt.q;
  $('#wl-status-me').textContent = '👤 你：等待中'; $('#wl-status-me').classList.remove('done');
  $('#wl-status-partner').textContent = '❤️ TA：等待中'; $('#wl-status-partner').classList.remove('done');
  $('#btn-submit-wish').disabled = false; $('#wl-input').disabled = false; $('#wl-input').value = '';
  $('#wl-input').focus();
});

socket.on('wishlist_reveal', function (data) {
  show('wishlist-reveal');
  if (data.items.length >= 1) { $('#wl-name1').textContent = data.items[0].nickname; $('#wl-text1').textContent = data.items[0].text; }
  if (data.items.length >= 2) { $('#wl-name2').textContent = data.items[1].nickname; $('#wl-text2').textContent = data.items[1].text; }
  spawnConfetti();
});

socket.on('wishlist_finished', function (data) {
  show('wishlist-finished');
  $('#wl-list').innerHTML = data.items.map(function (item) {
    return '<div class="wl-item"><div class="wl-item-prompt">' + item.prompt.icon + ' ' + item.prompt.q + '</div>' +
      item.answers.map(function (a) { return '<div class="wl-ans-line"><b>' + a.nickname + '</b>：' + a.text + '</div>'; }).join('') + '</div>';
  }).join('');
  spawnConfetti();
});

// --- Roleplay ---
socket.on('roleplay_round', function (data) {
  show('roleplay-playing');
  $('#rp-round').textContent = data.round; $('#rp-total').textContent = data.totalRounds;
  $('#rp-scenario-text').textContent = data.scenario;
  $('#rp-status-me').textContent = '👤 你：等待中'; $('#rp-status-me').classList.remove('done');
  $('#rp-status-partner').textContent = '❤️ TA：等待中'; $('#rp-status-partner').classList.remove('done');
  $('#btn-submit-rp').disabled = false; $('#rp-input').disabled = false; $('#rp-input').value = '';
  $('#rp-input').focus();
});

socket.on('roleplay_reveal', function (data) {
  show('roleplay-reveal');
  $('#rp-reveal-scenario').textContent = data.scenario;
  if (data.items.length >= 1) { $('#rp-name1').textContent = data.items[0].nickname; $('#rp-text1').textContent = data.items[0].text; }
  if (data.items.length >= 2) { $('#rp-name2').textContent = data.items[1].nickname; $('#rp-text2').textContent = data.items[1].text; }
});

socket.on('roleplay_finished', function () { show('roleplay-finished'); spawnConfetti(); });

// --- Draw ---
socket.on('draw_round', function (data) {
  show('draw-playing');
  $('#dr-round').textContent = data.round; $('#dr-total').textContent = data.totalRounds;
  isDrawer = data.drawerId === socket.id;
  $('#btn-next-dr').style.display = 'none';
  $('#draw-guesses').innerHTML = '';
  if (isDrawer) {
    $('#draw-word-display').innerHTML = '<div class="draw-word">🎨 你来画：<b>' + data.word + '</b></div>';
    $('#guess-area').style.display = 'none';
    if (drawCtx) drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  } else {
    $('#draw-word-display').innerHTML = '<div class="draw-word">🔍 ' + data.drawerName + ' 在画，你来猜！<b>' + data.word.length + '</b> 个字</div>';
    $('#guess-area').style.display = 'block';
    if (drawCtx) drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  }
});

socket.on('draw_line', function (data) {
  if (isDrawer || !drawCtx) return;
  drawCtx.strokeStyle = data.color || '#333';
  if (data.isStart) { drawCtx.beginPath(); drawCtx.moveTo(data.x, data.y); }
  else { drawCtx.lineTo(data.x, data.y); drawCtx.stroke(); }
});

socket.on('draw_clear', function () {
  if (isDrawer || !drawCtx) return;
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
});

socket.on('guess_result', function (data) {
  var el = $('#draw-guesses');
  if (data.correct) {
    el.innerHTML += '<div class="guess-correct">✅ ' + data.guesser + ' 猜对了！答案是：' + data.word + '</div>';
    $('#btn-next-dr').style.display = 'block';
    $('#guess-area').style.display = 'none';
    spawnConfetti();
  } else {
    el.innerHTML += '<div class="guess-wrong">❌ ' + data.guesser + '：「' + data.guess + '」不对</div>';
  }
});

socket.on('draw_finished', function (data) {
  show('draw-finished');
  var s = data.players.sort(function (a, b) { return b.score - a.score; });
  $('#dr-verdict').textContent = s[0].score > s[1].score ? '🏆 ' + s[0].nickname + ' 是猜词王！' : '平手！都很厉害～';
  $('#dr-score-board').innerHTML = s.map(function (p) {
    return '<div class="score-row"><span class="name">' + p.nickname + '</span><span class="score">' + p.score + ' 分</span></div>';
  }).join('');
  spawnConfetti();
});

socket.on('partner_left', function () { toast('TA 离开了房间 😢'); show('lobby'); });

// ====== Waiting room ======
function updateWaiting(room) {
  if (room.state !== 'waiting') return;
  var players = Object.values(room.players);
  $('#waiting-room-id').textContent = room.roomId;
  $('#waiting-room-name').textContent = room.name;
  $('#waiting-game-tag').textContent = room.gameModeLabel || '默契挑战';
  var gm = room.gameMode;
  var c = gm === 'story' ? '#ff6b6b' : gm === 'wishlist' ? '#ffa726' : gm === 'roleplay' ? '#ec407a' : gm === 'draw' ? '#5c6bc0' : '#7c5cfc';
  $('#waiting-game-tag').style.background = c === '#7c5cfc' ? '#f0ecff' : '#f0ecff';
  $('#waiting-game-tag').style.color = c;
  $('#waiting-theme-tag').textContent = room.themeLabel || '';
  $('#waiting-theme-tag').style.display = gm === 'quiz' ? 'inline-block' : 'none';
  if (players.length >= 1) { $('#waiting-player1').textContent = players[0].nickname; $('#player-card-host').classList.add('filled'); }
  if (players.length >= 2) {
    $('#waiting-player2').textContent = players[1].nickname;
    $('#player-card-guest').classList.remove('empty'); $('#player-card-guest').classList.add('filled');
    $('#btn-start').disabled = false; $('#btn-start').textContent = '开始游戏！';
  } else {
    $('#player-card-guest').classList.add('empty'); $('#player-card-guest').classList.remove('filled');
    $('#waiting-player2').textContent = '等待中...'; $('#btn-start').disabled = true; $('#btn-start').textContent = '等待 TA 加入...';
  }
}

function spawnConfetti() {
  var c = $('#confetti-container');
  var colors = ['#ff6b9d', '#7c5cfc', '#ffb300', '#4caf50', '#ff9800', '#00bcd4'];
  var emojis = ['💕', '✨', '💖', '🌟', '💝', '🎉', '💞', '💗'];
  var f = document.createDocumentFragment();
  for (var i = 0; i < 35; i++) {
    var p = document.createElement('div'); p.className = 'confetti-piece';
    p.style.left = Math.random() * 100 + '%'; p.style.top = -(Math.random() * 20) + 'px';
    p.style.animationDelay = Math.random() * 0.8 + 's'; p.style.animationDuration = (1.5 + Math.random() * 2) + 's';
    p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    p.style.width = (8 + Math.random() * 14) + 'px'; p.style.height = (8 + Math.random() * 14) + 'px';
    p.style.borderRadius = Math.random() > 0.5 ? '50%' : '3px';
    if (Math.random() > 0.7) { p.textContent = emojis[Math.floor(Math.random() * emojis.length)]; p.style.fontSize = '16px'; p.style.backgroundColor = 'transparent'; }
    f.appendChild(p);
  }
  c.innerHTML = ''; c.appendChild(f);
  setTimeout(function () { c.innerHTML = ''; }, 3000);
}

document.addEventListener('keydown', function (e) {
  if (e.key !== 'Enter') return;
  if ($('#lobby').classList.contains('active')) { if ($('#tab-create').classList.contains('active')) $('#btn-create').click(); else $('#btn-join').click(); }
  if ($('#quiz-playing').classList.contains('active') && $('#fill-answer').style.display !== 'none') $('#btn-submit-fill').click();
  if ($('#quiz-result').classList.contains('active')) $('#btn-next-quiz').click();
  if ($('#story-playing').classList.contains('active') && !$('#story-input').disabled) $('#btn-submit-story').click();
  if ($('#wishlist-playing').classList.contains('active') && !$('#wl-input').disabled) $('#btn-submit-wish').click();
  if ($('#wishlist-reveal').classList.contains('active')) $('#btn-next-wish').click();
  if ($('#roleplay-playing').classList.contains('active') && !$('#rp-input').disabled) $('#btn-submit-rp').click();
  if ($('#roleplay-reveal').classList.contains('active')) $('#btn-next-rp').click();
  if ($('#draw-playing').classList.contains('active') && !isDrawer) { var gi = $('#guess-input'); if (gi && gi.value.trim()) $('#btn-submit-guess').click(); }
});
