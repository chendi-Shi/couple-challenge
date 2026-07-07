import os
import json
import random
import string
import requests
from datetime import datetime
from flask import Flask, send_from_directory
from flask_socketio import SocketIO, emit, join_room, leave_room

app = Flask(__name__, static_folder='public', static_url_path='')
app.config['SECRET_KEY'] = 'couple-challenge-secret'
socketio = SocketIO(app, cors_allowed_origins='*', async_mode='threading',
                     max_http_buffer_size=int(1e6), ping_timeout=60)

# ===================== DeepSeek API =====================
DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions'

def call_deepseek(messages, api_key, max_tokens=600):
    resp = requests.post(DEEPSEEK_URL, json={
        'model': 'deepseek-chat',
        'messages': messages,
        'temperature': 0.9,
        'max_tokens': max_tokens,
    }, headers={
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + api_key,
    }, timeout=30)
    if resp.status_code != 200:
        raise Exception('DeepSeek error %d: %s' % (resp.status_code, resp.text))
    return resp.json()['choices'][0]['message']['content']

def generate_ai_question(api_key):
    prompt = '''你是一个情侣默契挑战的出题助手。请生成一道有趣的情侣默契题目。

要求：
- 随机选择题目类型：选择题(choice)、谁更可能(who)、填空题(fill)
- 选择题需要有 4 个选项，要有趣、贴近情侣日常
- "谁更可能"题选项固定为 ["我", "TA"]
- 填空题不需要选项
- 题目要有新意，不要老套
- 可以是关于异地恋、日常相处、旅行、美食、未来规划等话题
- category 字段用中文标签，如"默契""日常""旅行""美食""未来""甜蜜"

返回纯 JSON，不要 markdown 代码块，格式如下：
{"type":"choice或who或fill","q":"题目文字","options":["选项1","选项2","选项3","选项4"],"category":"分类标签"}'''
    text = call_deepseek([
        {'role': 'system', 'content': '你是一个创意情侣游戏出题助手。只返回纯 JSON，不要任何其他文字。'},
        {'role': 'user', 'content': prompt},
    ], api_key, 400)
    text = text.strip()
    if text.startswith('```'):
        text = text.replace('```json', '').replace('```', '').strip()
    return json.loads(text)

def generate_ai_commentary(question, answers, api_key):
    answer_list = '\n'.join(['%s：%s' % (a['nickname'], a['answer']) for a in answers.values()])
    prompt = '题目：' + question['q'] + '\n\n两人的回答：\n' + answer_list + \
        '\n\n请用 2-3 句话点评这对情侣的回答。风格要甜、有趣、暖心，像朋友在调侃又像在祝福。不要重复题目和答案，直接给出评语。'
    return call_deepseek([
        {'role': 'system', 'content': '你是一个温暖又幽默的恋爱观察员。点评情侣的默契回答，风格甜趣暖心。'},
        {'role': 'user', 'content': prompt},
    ], api_key, 250)

def generate_ai_summary(history, players, api_key):
    rounds_text = ''
    for i, item in enumerate(history):
        rounds_text += '第%d题：%s\n' % (i + 1, item['question']['q'])
        for a in item['answers'].values():
            rounds_text += '  %s：%s\n' % (a['nickname'], a['answer'])
        rounds_text += '  → 默契！\n\n' if item['bonus'] else '  → 想法不同\n\n'
    names = ' 和 '.join([p['nickname'] for p in players.values()])
    scores = '，'.join(['%s %d分' % (p['nickname'], p['score']) for p in players.values()])
    prompt = '这对情侣刚完成了一局默契挑战。\n\n玩家：%s\n得分：%s\n\n全部问答记录：\n%s\n\n请根据以上内容，写一段 120 字左右的暖心总结。风格像一封短信，温暖、真诚，可以适当调侃但充满祝福。提到一两处他们回答中具体的有趣细节。不要用"亲爱的XX"开头，直接开始写。' % (names, scores, rounds_text)
    return call_deepseek([
        {'role': 'system', 'content': '你是一个温暖真诚的情感写作者。为情侣游戏写暖心总结，风格自然不油腻。'},
        {'role': 'user', 'content': prompt},
    ], api_key, 400)

# ===================== 主题 =====================
THEMES = {
    'random':   {'name': '🎲 随机混搭',  'desc': '各种题型随机出现，每次都有惊喜', 'icon': '🎲'},
    'food':     {'name': '🍜 美食',      'desc': '关于吃的甜蜜默契', 'icon': '🍜'},
    'travel':   {'name': '✈️ 旅行',      'desc': '想象一起出行的场景', 'icon': '✈️'},
    'love':     {'name': '💕 恋爱',      'desc': '关于我们之间的那些事', 'icon': '💕'},
    'daily':    {'name': '🏠 日常',      'desc': '宅在一起的日常想象', 'icon': '🏠'},
    'deeptalk': {'name': '💬 真心话',    'desc': '走心的问题，更了解彼此', 'icon': '💬'},
    'ai':       {'name': '🤖 AI 智能出题', 'desc': 'DeepSeek 实时生成，永不重复', 'icon': '🤖'},
}

# ===================== 题库 =====================
QUESTION_BANK = {
    'food': [
        {'type': 'choice', 'q': '下次见面第一顿最想一起吃什么？', 'options': ['火锅', '日料', '路边摊小吃', '在家一起做']},
        {'type': 'choice', 'q': 'TA 最可能挑食的食物是？', 'options': ['香菜', '胡萝卜', '青椒', 'TA 不挑食']},
        {'type': 'who',    'q': '谁做饭更好吃？', 'options': ['我', 'TA']},
        {'type': 'choice', 'q': '深夜饿了，你更想和 TA 一起吃什么？', 'options': ['泡面配鸡蛋', '烧烤摊', '冰箱剩菜瞎凑合', '点外卖']},
        {'type': 'fill',   'q': '你吃过 TA 做的（或描述过的）最好吃的东西是什么？', 'options': []},
        {'type': 'choice', 'q': '如果一起开一家店，你们想开什么？', 'options': ['甜品店', '深夜食堂', '咖啡书店', '奶茶店']},
        {'type': 'who',    'q': '谁更容易把厨房炸了？', 'options': ['我', 'TA']},
        {'type': 'choice', 'q': '一起逛超市，TA 最可能先冲向哪个区？', 'options': ['零食区', '水果区', '熟食区', '酒水区']},
        {'type': 'fill',   'q': '说出 TA 最爱吃的一个东西，要具体到怎么做的', 'options': []},
        {'type': 'choice', 'q': '如果 TA 给你做了一顿饭，你觉得会是什么菜？', 'options': ['番茄炒蛋', '牛排红酒', '一锅乱炖', '就...一碗面']},
    ],
    'travel': [
        {'type': 'choice', 'q': '如果能一起去旅行，第一站去哪儿？', 'options': ['海边度假', '古城小巷', '雪山温泉', '繁华都市']},
        {'type': 'choice', 'q': 'TA 最想和你在旅途中做什么？', 'options': ['一起看日出', '逛当地集市', '躺在酒店不出去', '拍一大堆照片']},
        {'type': 'who',    'q': '谁更可能迷路？', 'options': ['我', 'TA']},
        {'type': 'choice', 'q': '旅行中，TA 更可能在什么东西上花钱？', 'options': ['美食', '纪念品', '体验项目', '住宿']},
        {'type': 'fill',   'q': '如果只带一件东西，你觉得 TA 会给你们的旅行带什么？', 'options': []},
        {'type': 'who',    'q': '谁收拾行李更快？', 'options': ['我', 'TA']},
        {'type': 'choice', 'q': '旅行的方式，你们更倾向哪种？', 'options': ['特种兵式打卡', '慢悠悠闲逛', '跟着感觉走', '提前规划每一站']},
        {'type': 'fill',   'q': '你最想和 TA 一起去的城市是哪里？（三个字以内）', 'options': []},
        {'type': 'choice', 'q': '旅途中 TA 最可能说什么？', 'options': ['"好美啊！"', '"好累啊..."', '"这个好好吃！"', '"我们再待一天吧"']},
        {'type': 'who',    'q': '谁拍照更好看？', 'options': ['我', 'TA']},
    ],
    'love': [
        {'type': 'fill',   'q': '用三个词形容 TA 在你心里的样子', 'options': []},
        {'type': 'choice', 'q': '你觉得哪种方式最浪漫？', 'options': ['睡前互道晚安', '突然收到 TA 点的外卖', 'TA 记住你随口说的话', '一起规划下次见面']},
        {'type': 'fill',   'q': 'TA 做过的哪件小事，让你觉得"就是这个人了"？', 'options': []},
        {'type': 'who',    'q': '谁先心动的？', 'options': ['我', 'TA']},
        {'type': 'choice', 'q': '你更希望收到什么礼物？', 'options': ['一封手写信', '一个惊喜包裹', '一首 TA 唱的歌', '一起的合照拼图']},
        {'type': 'fill',   'q': '第一次见到 TA 时，你心里在想什么？', 'options': []},
        {'type': 'who',    'q': '谁更爱撒娇？', 'options': ['我', 'TA']},
        {'type': 'choice', 'q': '你觉得 TA 最喜欢你的什么？', 'options': ['性格', '外表', '才华', '对我好的方式']},
        {'type': 'fill',   'q': '如果有超能力，你最想为 TA 做什么？', 'options': []},
        {'type': 'who',    'q': '谁更可能突然给对方惊喜？', 'options': ['我', 'TA']},
    ],
    'daily': [
        {'type': 'choice', 'q': '宅在家的时候，TA 更想干嘛？', 'options': ['一起追剧', '各玩各的', '一起做饭', '打游戏']},
        {'type': 'choice', 'q': '下雨天最想 TA 在你身边做什么？', 'options': ['窝在沙发聊天', '一起听雨发呆', '煮一壶热茶', '打伞散步']},
        {'type': 'who',    'q': '谁更可能睡过头？', 'options': ['我', 'TA']},
        {'type': 'choice', 'q': '如果一起住，家务怎么分？', 'options': ['我做清洁 TA 做饭', 'TA 全包（我想得美）', '我全包（TA 想得美）', '一起干，谁也别逃']},
        {'type': 'fill',   'q': '描述一下：和 TA 住在一起的第一天早上，是什么画面？', 'options': []},
        {'type': 'who',    'q': '谁更可能把东西弄丢？', 'options': ['我', 'TA']},
        {'type': 'choice', 'q': '晚上睡不着，你更希望 TA 怎么做？', 'options': ['打电话陪你聊', '给你讲故事', '陪你看剧到睡着', 'TA 睡你的，不用管我']},
        {'type': 'who',    'q': '谁更可能在电影院睡着？', 'options': ['我', 'TA']},
        {'type': 'fill',   'q': '你觉得 TA 最需要被照顾的一个瞬间是什么？', 'options': []},
        {'type': 'choice', 'q': 'TA 在家最可能躺在哪？', 'options': ['沙发上刷手机', '床上不起来', '地毯上瘫着', '厨房站着吃东西']},
    ],
    'deeptalk': [
        {'type': 'fill',   'q': '异地这段时间，你学到最重要的一件事是什么？', 'options': []},
        {'type': 'fill',   'q': '你觉得十年后的你们，会在哪里、在做什么？', 'options': []},
        {'type': 'choice', 'q': '吵架了，你觉得什么方式最能让你们和好？', 'options': ['一个人先服软', '冷静后好好聊', '一个拥抱就够了', '发一个搞笑表情包']},
        {'type': 'fill',   'q': '你最想对 TA 说但一直没说出口的一句话是什么？', 'options': []},
        {'type': 'choice', 'q': '你觉得一段感情里最重要的是什么？', 'options': ['信任', '沟通', '陪伴', '一起成长']},
        {'type': 'fill',   'q': '你觉得你们最默契的一个瞬间是什么？', 'options': []},
        {'type': 'who',    'q': '谁更记不住纪念日？', 'options': ['我', 'TA']},
        {'type': 'choice', 'q': '你觉得你们在一起最大的变化是什么？', 'options': ['变温柔了', '变幼稚了', '变勇敢了', '变得更像对方了']},
        {'type': 'fill',   'q': '给 3 个月后的 TA 写一句话吧', 'options': []},
        {'type': 'who',    'q': '吵架时谁先道歉？', 'options': ['我', 'TA']},
    ],
}

CHALLENGES = [
    {'text': '给对方发一段语音："你今天真好看"', 'emoji': '🎙️'},
    {'text': '截屏这个画面，发给对方', 'emoji': '📸'},
    {'text': '对着屏幕比个心，等对方也做了再继续', 'emoji': '🫶'},
    {'text': '原地转三圈！然后告诉对方你晕了', 'emoji': '🌀'},
    {'text': '现在立刻给对方发一个你最喜欢的表情包', 'emoji': '🤪'},
    {'text': '学一种动物的叫声，发给对方听', 'emoji': '🐱'},
    {'text': '闭上眼睛想 TA 的脸，想 10 秒再睁开', 'emoji': '💭'},
    {'text': '用最快的速度打出"我喜欢你"，看谁先发出', 'emoji': '⏱️'},
    {'text': '现在马上跟对方说一句今天还没说的话', 'emoji': '💌'},
    {'text': '站起来，做一个搞笑的动作发给对方看', 'emoji': '🕺'},
    {'text': '给对方发一条语音，只用一个字描述今天的心情', 'emoji': '🎤'},
    {'text': '想象对方正在你面前，做一个你见面会做的第一件事', 'emoji': '💕'},
]

def get_daily_question():
    days = [
        {'type': 'fill', 'q': '周一：这周你最期待和 TA 一起做的一件事是什么？', 'options': []},
        {'type': 'choice', 'q': '周二：今天最想和 TA 一起喝什么？', 'options': ['咖啡', '奶茶', '白水就够', '喝酒！']},
        {'type': 'fill',   'q': '周三：一周过半，想对 TA 说什么？', 'options': []},
        {'type': 'choice', 'q': '周四：周末快到了，你最想和 TA 做什么？', 'options': ['视频到很晚', '一起看一部电影', '什么也不做，就挂着', '玩一局游戏']},
        {'type': 'fill',   'q': '周五：用一个颜色形容今天的心情，为什么？', 'options': []},
        {'type': 'choice', 'q': '周六：如果此刻 TA 就在身边，你最可能干嘛？', 'options': ['拥抱一下', '拉着出门', '一起躺着', '去做饭']},
        {'type': 'fill',   'q': '周日：这周最想对 TA 说谢谢的一件事是什么？', 'options': []},
    ]
    idx = (datetime.now().weekday() + datetime.now().day) % len(days)
    return days[idx]

# ===================== 房间管理 =====================
rooms = {}
TOTAL_ROUNDS = 5

def create_room(name, host_name, theme_key, api_key):
    return {
        'name': name,
        'players': {},
        'theme': theme_key or 'random',
        'api_key': api_key or '',
        'round': 0,
        'total_rounds': TOTAL_ROUNDS,
        'state': 'waiting',
        'questions': [],
        'round_history': [],
        'challenge_injected': False,
        '_answers': {},
        'current_question': None,
    }

def room_info(room, rid):
    return {
        'roomId': rid,
        'name': room['name'],
        'theme': room['theme'],
        'themeLabel': THEMES.get(room['theme'], {}).get('name', ''),
        'hasAI': bool(room['api_key'] and room['theme'] == 'ai'),
        'state': room['state'],
        'round': room['round'],
        'totalRounds': room['total_rounds'],
        'players': {pid: {'nickname': p['nickname'], 'score': p['score'], 'streak': p.get('streak', 0)}
                    for pid, p in room['players'].items()},
    }

def get_room_id(room):
    for rid, r in rooms.items():
        if r is room:
            return rid
    return ''

def pick_question(room):
    if room['round'] == 1 and random.random() < 0.3:
        return get_daily_question()
    if room['round'] == 3 and not room['challenge_injected'] and random.random() < 0.4:
        room['challenge_injected'] = True
        c = random.choice(CHALLENGES)
        return {'type': 'challenge', 'category': '小挑战', 'q': c['text'],
                'options': ['我完成了！', 'TA 先完成！'], 'emoji': '⚡'}

    # AI 主题
    if room['theme'] == 'ai' and room['api_key']:
        try:
            ai_q = generate_ai_question(room['api_key'])
            room['questions'].append('ai_%d' % room['round'])
            return ai_q
        except Exception as e:
            print('AI 出题失败, fallback: ' + str(e))

    # 按主题选题
    if room['theme'] in ('random', 'ai'):
        pool = []
        for v in QUESTION_BANK.values():
            pool.extend(v)
    else:
        pool = QUESTION_BANK.get(room['theme'], [])

    used = set(room['questions'])
    available = [q for q in pool if '%s_%d' % (room['theme'], pool.index(q)) not in used]
    if not available:
        room['questions'] = []
        return random.choice(pool)

    q = random.choice(available)
    room['questions'].append('%s_%d' % (room['theme'], pool.index(q)))
    return q

def next_round_sync(room):
    room['round'] += 1
    if room['round'] > room['total_rounds']:
        finish_game(room)
        return

    q = pick_question(room)
    room['current_question'] = q
    room['_answers'] = {}

    rid = get_room_id(room)
    socketio.emit('new_round', {
        'round': room['round'],
        'totalRounds': room['total_rounds'],
        'question': q,
    }, to=rid)

def reveal_round(room):
    player_ids = list(room['players'].keys())
    answers = {}
    for pid in player_ids:
        answers[pid] = {
            'nickname': room['players'][pid]['nickname'],
            'answer': room['_answers'].get(pid, ''),
        }

    q = room['current_question']
    bonus = 0

    if q['type'] == 'who':
        vals = list(room['_answers'].values())
        if len(vals) >= 2 and vals[0] != vals[1]:
            bonus = 1
    elif q['type'] == 'choice':
        vals = list(room['_answers'].values())
        if len(vals) >= 2 and vals[0] == vals[1]:
            bonus = 1

    if bonus:
        for p in room['players'].values():
            p['score'] += bonus
            p['streak'] = p.get('streak', 0) + 1
    else:
        for p in room['players'].values():
            p['streak'] = 0

    room['round_history'].append({'question': q, 'answers': answers, 'bonus': bonus > 0})

    rid = get_room_id(room)
    socketio.emit('round_result', {'answers': answers, 'question': q, 'bonus': bonus > 0}, to=rid)
    socketio.emit('room_update', room_info(room, rid), to=rid)

    # AI 点评 (async)
    if room['api_key']:
        try:
            comment = generate_ai_commentary(q, answers, room['api_key'])
            socketio.emit('ai_commentary', {'text': comment}, to=rid)
        except Exception as e:
            print('AI 点评失败: ' + str(e))

def finish_game(room):
    room['state'] = 'finished'
    rid = get_room_id(room)
    sorted_players = sorted(room['players'].values(), key=lambda p: p['score'], reverse=True)
    total = sum(p['score'] for p in sorted_players)

    VERDICTS = [
        {'min': 0, 'text': '看来你们还有很多惊喜等着彼此去发现呢 ✨', 'emoji': '🌱'},
        {'min': 1, 'text': '默契正在慢慢发芽～多聊聊吧 💕',           'emoji': '🌿'},
        {'min': 2, 'text': '有在认真了解彼此哦！继续加油 🫶',         'emoji': '🌸'},
        {'min': 3, 'text': '很不错！你们对彼此的了解程度很高了 💖',    'emoji': '💐'},
        {'min': 4, 'text': '太强了吧！简直是灵魂伴侣 💯',              'emoji': '🔥'},
        {'min': 5, 'text': '满分默契！你俩就是命中注定 🎯',            'emoji': '👑'},
    ]
    v = [x for x in VERDICTS if total >= x['min']][-1]

    socketio.emit('game_finished', {
        'players': [{'nickname': p['nickname'], 'score': p['score']} for p in sorted_players],
        'verdict': v['text'] + ' ' + v['emoji'],
        'emoji': v['emoji'],
        'history': room['round_history'],
    }, to=rid)
    socketio.emit('room_update', room_info(room, rid), to=rid)

    # AI 总结 (async)
    if room['api_key'] and room['round_history']:
        try:
            summary = generate_ai_summary(room['round_history'], room['players'], room['api_key'])
            socketio.emit('ai_summary', {'text': summary}, to=rid)
        except Exception as e:
            print('AI 总结失败: ' + str(e))

# ===================== 路由 =====================
@app.route('/')
def index():
    return send_from_directory('public', 'index.html')

# ===================== Socket.IO =====================
@socketio.on('connect')
def on_connect():
    print('[+] connected')

@socketio.on('create_room')
def on_create_room(data):
    room_id = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
    room = create_room(data.get('roomName', '甜蜜小屋'), data.get('nickname', ''),
                        data.get('theme', 'random'), data.get('apiKey', ''))
    room_id_upper = room_id.upper()
    room['players'][room_id_upper] = {
        'id': room_id_upper, 'nickname': data.get('nickname', ''), 'score': 0, 'streak': 0
    }
    rooms[room_id_upper] = room
    join_room(room_id_upper)
    return {'ok': True, 'roomId': room_id_upper, 'room': room_info(room, room_id_upper)}

@socketio.on('join_room')
def on_join_room(data):
    rid = (data.get('roomId', '')).upper()
    nickname = data.get('nickname', '')
    room = rooms.get(rid)
    if not room:
        return {'ok': False, 'error': '房间不存在'}
    if len(room['players']) >= 2:
        return {'ok': False, 'error': '房间已满'}
    from flask_socketio import request as sio_request
    room['players'][sio_request.sid] = {
        'id': sio_request.sid, 'nickname': nickname, 'score': 0, 'streak': 0
    }
    join_room(rid)
    emit('room_update', room_info(room, rid), to=rid)
    return {'ok': True, 'roomId': rid, 'room': room_info(room, rid)}

@socketio.on('start_game')
def on_start_game():
    from flask_socketio import request as sio_request
    room = rooms.get(_get_room(sio_request.sid))
    if not room or len(room['players']) < 2:
        return
    if room['state'] != 'waiting':
        return
    room['state'] = 'playing'
    room['round'] = 0
    room['questions'] = []
    room['round_history'] = []
    room['challenge_injected'] = False
    for p in room['players'].values():
        p['score'] = 0
        p['streak'] = 0
    next_round_sync(room)

@socketio.on('submit_answer')
def on_submit_answer(answer):
    from flask_socketio import request as sio_request
    room = rooms.get(_get_room(sio_request.sid))
    if not room or room['state'] != 'playing':
        return
    room['_answers'][sio_request.sid] = answer
    emit('player_answered', {
        'playerId': sio_request.sid,
        'nickname': room['players'][sio_request.sid]['nickname'],
    }, to=_get_room(sio_request.sid))

    if all(room['_answers'].get(pid) for pid in room['players']):
        reveal_round(room)

@socketio.on('next_round')
def on_next_round():
    from flask_socketio import request as sio_request
    room = rooms.get(_get_room(sio_request.sid))
    if not room or room['state'] != 'playing':
        return
    room['_answers'] = {}
    next_round_sync(room)

@socketio.on('play_again')
def on_play_again():
    from flask_socketio import request as sio_request
    room = rooms.get(_get_room(sio_request.sid))
    if not room:
        return
    room['state'] = 'waiting'
    room['round'] = 0
    room['questions'] = []
    room['round_history'] = []
    room['_answers'] = {}
    room['challenge_injected'] = False
    for p in room['players'].values():
        p['score'] = 0
        p['streak'] = 0
    emit('room_update', room_info(room, _get_room(sio_request.sid)), to=_get_room(sio_request.sid))

@socketio.on('disconnect')
def on_disconnect():
    from flask_socketio import request as sio_request
    room = rooms.get(_get_room(sio_request.sid))
    if not room:
        return
    del room['players'][sio_request.sid]
    rid = _get_room(sio_request.sid)
    if not room['players']:
        del rooms[rid]
    else:
        room['state'] = 'waiting'
        room['_answers'] = {}
        emit('partner_left', to=rid)
        emit('room_update', room_info(room, rid), to=rid)

def _get_room(sid):
    for rid, room in rooms.items():
        if sid in room['players']:
            return rid
    return ''

# ===================== 入口 =====================
if __name__ == '__main__':
    PORT = int(os.environ.get('PORT', 3456))
    print('💞 情侣默契挑战 v4 (Python) http://0.0.0.0:%d' % PORT)
    socketio.run(app, host='0.0.0.0', port=PORT, allow_unsafe_werkzeug=True)
