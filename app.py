import os
import json
import random
import string
import requests
import threading
import time
from datetime import datetime
import gradio as gr

# ===================== DeepSeek API =====================
DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions'

def call_deepseek(messages, api_key, max_tokens=600):
    resp = requests.post(DEEPSEEK_URL, json={
        'model': 'deepseek-chat', 'messages': messages,
        'temperature': 0.9, 'max_tokens': max_tokens,
    }, headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api_key}, timeout=30)
    if resp.status_code != 200:
        raise Exception('DeepSeek error %d' % resp.status_code)
    return resp.json()['choices'][0]['message']['content']

def generate_ai_question(api_key):
    prompt = '''你是一个情侣默契挑战的出题助手。请生成一道有趣的情侣默契题目。
返回纯 JSON，不要 markdown 代码块：
{"type":"choice或who或fill","q":"题目文字","options":["选项1","选项2"...],"category":"分类标签"}
选择题 4 个选项，"谁更可能"题选项固定 ["我", "TA"]，填空题选项为 []。
题目要有新意，贴近情侣日常。'''
    text = call_deepseek([
        {'role': 'system', 'content': '只返回纯 JSON，不要任何其他文字。'},
        {'role': 'user', 'content': prompt},
    ], api_key, 400)
    text = text.strip().replace('```json', '').replace('```', '').strip()
    return json.loads(text)

def generate_ai_commentary(question, answers, api_key):
    answer_list = '\n'.join(['%s：%s' % (a['nickname'], a['answer']) for a in answers.values()])
    prompt = '题目：' + question['q'] + '\n\n回答：\n' + answer_list + '\n\n用 2-3 句甜趣暖心点评一下。'
    return call_deepseek([
        {'role': 'system', 'content': '温暖幽默的恋爱观察员。'},
        {'role': 'user', 'content': prompt},
    ], api_key, 250)

def generate_ai_summary(history, players, api_key):
    rounds = ''
    for i, item in enumerate(history):
        rounds += '第%d题：%s\n' % (i + 1, item['question']['q'])
        for a in item['answers'].values():
            rounds += '  %s：%s\n' % (a['nickname'], a['answer'])
    names = ' & '.join([p['nickname'] for p in players.values()])
    prompt = '玩家：%s\n问答：\n%s\n写一段 120 字暖心总结。' % (names, rounds)
    return call_deepseek([
        {'role': 'system', 'content': '温暖真诚的情感写作者。'},
        {'role': 'user', 'content': prompt},
    ], api_key, 400)

# ===================== 数据 =====================
THEMES = {
    'random': '🎲 随机混搭', 'food': '🍜 美食', 'travel': '✈️ 旅行',
    'love': '💕 恋爱', 'daily': '🏠 日常', 'deeptalk': '💬 真心话', 'ai': '🤖 AI 智能出题',
}

QUESTION_BANK = {
    'food': [
        {'type': 'choice', 'q': '下次见面第一顿最想一起吃什么？', 'options': ['火锅', '日料', '路边摊小吃', '在家一起做']},
        {'type': 'choice', 'q': 'TA 最可能挑食的食物是？', 'options': ['香菜', '胡萝卜', '青椒', 'TA 不挑食']},
        {'type': 'who',    'q': '谁做饭更好吃？', 'options': ['我', 'TA']},
        {'type': 'choice', 'q': '深夜饿了，你更想和 TA 一起吃什么？', 'options': ['泡面配鸡蛋', '烧烤摊', '冰箱剩菜', '点外卖']},
        {'type': 'fill',   'q': '你吃过 TA 做的最好吃的东西是什么？', 'options': []},
        {'type': 'choice', 'q': '如果一起开店，开什么？', 'options': ['甜品店', '深夜食堂', '咖啡书店', '奶茶店']},
        {'type': 'who',    'q': '谁更容易把厨房炸了？', 'options': ['我', 'TA']},
        {'type': 'choice', 'q': '逛超市 TA 先冲向哪个区？', 'options': ['零食区', '水果区', '熟食区', '酒水区']},
        {'type': 'fill',   'q': '说出 TA 最爱吃的东西', 'options': []},
        {'type': 'choice', 'q': 'TA 给你做饭最可能是什么？', 'options': ['番茄炒蛋', '牛排红酒', '一锅乱炖', '一碗面']},
    ],
    'travel': [
        {'type': 'choice', 'q': '一起旅行第一站去哪儿？', 'options': ['海边度假', '古城小巷', '雪山温泉', '繁华都市']},
        {'type': 'choice', 'q': 'TA 最想在旅途中做什么？', 'options': ['看日出', '逛集市', '躺酒店', '拍照']},
        {'type': 'who',    'q': '谁更可能迷路？', 'options': ['我', 'TA']},
        {'type': 'choice', 'q': '旅行中 TA 最可能在什么上花钱？', 'options': ['美食', '纪念品', '体验项目', '住宿']},
        {'type': 'fill',   'q': 'TA 会给旅行带什么？', 'options': []},
        {'type': 'who',    'q': '谁收拾行李更快？', 'options': ['我', 'TA']},
        {'type': 'choice', 'q': '旅行方式？', 'options': ['特种兵打卡', '慢悠悠闲逛', '随感觉走', '提前规划']},
        {'type': 'fill',   'q': '最想和 TA 去的城市？', 'options': []},
        {'type': 'choice', 'q': '旅途中 TA 最可能说？', 'options': ['好美啊！', '好累啊...', '这个好好吃！', '再待一天吧']},
        {'type': 'who',    'q': '谁拍照更好看？', 'options': ['我', 'TA']},
    ],
    'love': [
        {'type': 'fill',   'q': '用三个词形容 TA', 'options': []},
        {'type': 'choice', 'q': '哪种方式最浪漫？', 'options': ['睡前晚安', '突然的外卖', '记住随口说的话', '一起规划见面']},
        {'type': 'fill',   'q': 'TA 做过的哪件小事让你心动？', 'options': []},
        {'type': 'who',    'q': '谁先心动的？', 'options': ['我', 'TA']},
        {'type': 'choice', 'q': '更想收到什么礼物？', 'options': ['手写信', '惊喜包裹', 'TA唱的歌', '合照拼图']},
        {'type': 'fill',   'q': '第一次见 TA 时在想什么？', 'options': []},
        {'type': 'who',    'q': '谁更爱撒娇？', 'options': ['我', 'TA']},
        {'type': 'choice', 'q': 'TA 最喜欢你什么？', 'options': ['性格', '外表', '才华', '对我的方式']},
        {'type': 'fill',   'q': '有超能力最想为 TA 做什么？', 'options': []},
        {'type': 'who',    'q': '谁更容易给惊喜？', 'options': ['我', 'TA']},
    ],
    'daily': [
        {'type': 'choice', 'q': '宅家时 TA 最想干嘛？', 'options': ['追剧', '各玩各的', '做饭', '打游戏']},
        {'type': 'choice', 'q': '下雨天最想 TA 陪你做什么？', 'options': ['窝沙发聊', '听雨发呆', '煮热茶', '打伞散步']},
        {'type': 'who',    'q': '谁更可能睡过头？', 'options': ['我', 'TA']},
        {'type': 'choice', 'q': '家务怎么分？', 'options': ['我扫TA做', 'TA全包', '我全包', '一起干']},
        {'type': 'fill',   'q': '和 TA 住一起第一天早上什么画面？', 'options': []},
        {'type': 'who',    'q': '谁更可能丢东西？', 'options': ['我', 'TA']},
        {'type': 'choice', 'q': '睡不着想 TA 怎么做？', 'options': ['电话聊', '讲故事', '陪看剧', '不用管我']},
        {'type': 'who',    'q': '谁在电影院更可能睡着？', 'options': ['我', 'TA']},
        {'type': 'fill',   'q': 'TA 最需要被照顾的瞬间？', 'options': []},
        {'type': 'choice', 'q': 'TA 在家最喜欢躺哪？', 'options': ['沙发刷手机', '床上不起来', '地毯瘫着', '厨房站着吃']},
    ],
    'deeptalk': [
        {'type': 'fill',   'q': '异地让你学到最重要的一件事？', 'options': []},
        {'type': 'fill',   'q': '十年后你们会在哪里做什么？', 'options': []},
        {'type': 'choice', 'q': '吵架后怎么和好最快？', 'options': ['一个人服软', '冷静后聊', '一个拥抱', '搞笑表情包']},
        {'type': 'fill',   'q': '最想对 TA 说但没说出口的话？', 'options': []},
        {'type': 'choice', 'q': '感情里最重要是什么？', 'options': ['信任', '沟通', '陪伴', '一起成长']},
        {'type': 'fill',   'q': '你们最默契的一个瞬间？', 'options': []},
        {'type': 'who',    'q': '谁更记不住纪念日？', 'options': ['我', 'TA']},
        {'type': 'choice', 'q': '在一起后最大的变化？', 'options': ['变温柔', '变幼稚', '变勇敢', '更像对方']},
        {'type': 'fill',   'q': '给 3 个月后的 TA 写一句话', 'options': []},
        {'type': 'who',    'q': '吵架谁先道歉？', 'options': ['我', 'TA']},
    ],
}

CHALLENGES = [
    {'text': '给对方发语音："你今天真好看"', 'emoji': '🎙️'},
    {'text': '截屏这个画面发给对方', 'emoji': '📸'},
    {'text': '对着屏幕比个心', 'emoji': '🫶'},
    {'text': '原地转三圈告诉对方', 'emoji': '🌀'},
    {'text': '给对方发一个表情包', 'emoji': '🤪'},
    {'text': '学一种动物叫声发给对方听', 'emoji': '🐱'},
    {'text': '闭眼想 TA 10 秒', 'emoji': '💭'},
    {'text': '最快速度打出"我喜欢你"', 'emoji': '⏱️'},
    {'text': '跟对方说一句今天还没说的话', 'emoji': '💌'},
]

TOTAL_ROUNDS = 5

# ===================== 全局状态 (简易内存存储) =====================
# 用字典存所有房间, 由于 Gradio 无 WebSocket，玩家轮询刷新
rooms = {}

def _room_id():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))

def _pick_question(room):
    if room['round'] == 1 and random.random() < 0.3:
        return {'type': 'fill', 'q': get_daily_q(), 'options': [], 'category': '每日彩蛋'}

    if room['theme'] == 'ai' and room.get('api_key'):
        try:
            q = generate_ai_question(room['api_key'])
            return q
        except Exception:
            pass

    if room['theme'] in ('random', 'ai'):
        pool = [q for v in QUESTION_BANK.values() for q in v]
    else:
        pool = QUESTION_BANK.get(room['theme'], [])
        if not pool:
            pool = [q for v in QUESTION_BANK.values() for q in v]

    # 避免重复
    used = set(room.get('used_qs', []))
    avail = [q for q in pool if q['q'] not in used]
    if not avail:
        room['used_qs'] = []
        avail = pool

    q = random.choice(avail)
    room.setdefault('used_qs', []).append(q['q'])

    # 第 3 题有概率出挑战卡
    if room['round'] == 3 and random.random() < 0.4:
        c = random.choice(CHALLENGES)
        return {'type': 'challenge', 'category': '小挑战', 'q': c['text'],
                'options': ['我完成了！', 'TA 先完成！'], 'emoji': c['emoji']}

    return q

def get_daily_q():
    qs = ['这周最期待和TA做什么？', '今天最想一起喝什么？', '一周过半想对TA说什么？',
          '周末最想和TA做什么？', '用一个颜色形容今天心情', '此刻TA在身边会做什么？', '这周最想感谢TA的事？']
    return qs[(datetime.now().weekday() + datetime.now().day) % len(qs)]

# ===================== Gradio UI =====================
CSS = """
.gradio-container { max-width: 480px !important; margin: 0 auto !important; }
body { background: #fef9fb !important; }
h1 { color: #333 !important; }
.btn-primary { background: #ff6b9d !important; border: none !important; }
.room-code { font-size: 2em; font-weight: bold; color: #7c5cfc; letter-spacing: 4px; text-align: center; }
"""

def create_room(nickname, room_name, theme, api_key):
    if not nickname:
        return "❌ 请输入昵称", "", "", gr.update(), gr.update(), gr.update(), gr.update()
    if theme == 'ai' and not api_key:
        return "❌ AI 主题需要 DeepSeek API Key", "", "", gr.update(), gr.update(), gr.update(), gr.update()

    rid = _room_id()
    room = {
        'name': room_name or '甜蜜小屋', 'theme': theme,
        'api_key': api_key.strip() if api_key else '',
        'players': {'host': {'nickname': nickname, 'score': 0}},
        'round': 0, 'state': 'waiting', 'used_qs': [],
        'current_question': None, 'answers': {}, 'history': [],
        'created_at': time.time(),
    }
    rooms[rid] = room

    status_html = f"""
    <div style='text-align:center;padding:20px'>
    <div style='font-size:14px;color:#999'>房间码</div>
    <div style='font-size:2.5em;font-weight:bold;color:#7c5cfc;letter-spacing:6px;margin:10px 0'>{rid}</div>
    <div style='font-size:14px;color:#999'>主题: {THEMES.get(theme,'随机')} | 房主: {nickname}</div>
    <div style='margin-top:16px;color:#999;font-size:13px'>把房间码发给 TA，然后刷新等待</div>
    </div>"""

    return (f"✅ 房间创建成功！", status_html, f"你在房间 {rid} 中",
            gr.update(value=nickname, interactive=False),
            gr.update(value=rid, interactive=False),
            gr.update(visible=True),
            gr.update(visible=True))

def join_room(nickname, room_id):
    if not nickname or not room_id:
        return "❌ 请输入昵称和房间码", "", "", gr.update(), gr.update(), gr.update(), gr.update()
    rid = room_id.strip().upper()
    room = rooms.get(rid)
    if not room:
        return "❌ 房间不存在", "", "", gr.update(), gr.update(), gr.update(), gr.update()
    if len(room['players']) >= 2:
        return "❌ 房间已满", "", "", gr.update(), gr.update(), gr.update(), gr.update()
    if room['state'] != 'waiting':
        return "❌ 游戏已开始", "", "", gr.update(), gr.update(), gr.update(), gr.update()

    room['players']['guest'] = {'nickname': nickname, 'score': 0}

    status_html = f"""
    <div style='text-align:center;padding:20px'>
    <div style='font-size:2.5em;font-weight:bold;color:#7c5cfc;letter-spacing:6px;margin:10px 0'>{rid}</div>
    <div style='font-size:14px;color:#999'>🐱 {room['players']['host']['nickname']} VS 🐶 {nickname}</div>
    <div style='margin-top:16px;color:#4caf50;font-weight:600'>已加入！等房主开始游戏</div>
    </div>"""

    return (f"✅ 加入成功！", status_html, f"你在房间 {rid} 中",
            gr.update(value=nickname, interactive=False),
            gr.update(value=rid, interactive=False),
            gr.update(visible=True),
            gr.update(visible=True))

def start_game(player_key, my_role):
    """房主点击开始。player_key 是 room_id, my_role='host'"""
    rid = player_key.strip().upper()
    room = rooms.get(rid)
    if not room:
        return "❌ 房间已失效，请重新创建", "", "", [], gr.update(visible=False), gr.update(visible=False), "", ""
    if len(room['players']) < 2:
        return "❌ 等待 TA 加入", "", "", [], gr.update(visible=False), gr.update(visible=False), "", ""
    if room['state'] == 'playing':
        return "游戏已在进行中", "", "", [], gr.update(visible=False), gr.update(visible=False), "", ""

    room['state'] = 'playing'
    room['round'] = 0
    room['answers'] = {}
    room['history'] = []
    room['used_qs'] = []
    for p in room['players'].values():
        p['score'] = 0
    return _next_round(rid, my_role)

def _next_round(rid, my_role):
    room = rooms.get(rid)
    if not room or room['state'] != 'playing':
        return "房间已失效", "", "", [], gr.update(visible=False), gr.update(visible=False), "", ""

    room['round'] += 1
    if room['round'] > TOTAL_ROUNDS:
        return _finish(rid, my_role)

    q = _pick_question(room)
    room['current_question'] = q
    room['answers'] = {}

    who = room['players']['host']['nickname'] if my_role == 'host' else room['players'].get('guest', {}).get('nickname', '')
    partner = room['players'].get('guest', {}).get('nickname', '') if my_role == 'host' else room['players']['host']['nickname']

    # 计算得分
    scores_text = "💕 比分: 👤你 %d 分 | ❤️TA %d 分" % (
        room['players'].get(my_role, {}).get('score', 0),
        room['players'].get('guest' if my_role == 'host' else 'host', {}).get('score', 0),
    )

    type_label = {'who': '谁更可能...', 'choice': '默契选择题', 'fill': '默契问答题', 'challenge': '⚡ 小挑战'}
    label = type_label.get(q.get('type', ''), '默契问答')
    category = q.get('category', '')
    question_html = f"""
    <div style='background:#fff;border-radius:16px;padding:24px;margin:10px 0;box-shadow:0 2px 12px rgba(0,0,0,.06)'>
    <div style='color:#7c5cfc;font-size:12px;font-weight:700;margin-bottom:8px'>{label} · {category}</div>
    <div style='font-size:1.2em;font-weight:600;line-height:1.6'>{q['q']}</div>
    </div>
    <div style='text-align:center;color:#4caf50;font-weight:600;margin-bottom:10px'>请提交你的答案，两人都提交后揭晓</div>
    """

    has_options = q.get('type') in ('choice', 'who', 'challenge') and q.get('options')
    return ("第 %d/%d 题" % (room['round'], TOTAL_ROUNDS),
            question_html,
            scores_text,
            gr.update(choices=q.get('options', []), visible=has_options),
            gr.update(visible=not has_options),
            gr.update(visible=True),
            gr.update(visible=False),
            gr.update(value="") if not has_options else gr.update())

def submit_answer(player_key, my_role, choice_answer, fill_answer):
    """提交答案"""
    rid = player_key.strip().upper()
    room = rooms.get(rid)
    if not room or room['state'] != 'playing':
        return "房间已失效", "", "", gr.update(visible=False), gr.update(visible=False), "", gr.update(visible=False)

    q = room['current_question']
    answer = fill_answer if q.get('type') == 'fill' else choice_answer
    if not answer:
        return "请先作答再提交", "", "", gr.update(), gr.update(), gr.update(), gr.update(visible=False)

    room['answers'][my_role] = answer

    # 等待双方都提交
    if len(room['answers']) < 2:
        return ("已提交！等待 TA 的答案...",
                _question_display(room, q),
                "⏳ 你已提交，等待 TA...",
                gr.update(visible=False), gr.update(visible=False),
                gr.update(visible=False), gr.update(visible=False))

    return _reveal(rid, my_role)

def _reveal(rid, my_role):
    room = rooms.get(rid)
    q = room['current_question']
    my_ans = room['answers'].get(my_role, '')
    other_role = 'guest' if my_role == 'host' else 'host'
    other_ans = room['answers'].get(other_role, '')
    my_name = room['players'][my_role]['nickname']
    other_name = room['players'][other_role]['nickname']

    bonus = False
    if q.get('type') == 'who':
        if my_ans != other_ans:
            bonus = True
    elif q.get('type') == 'choice':
        if my_ans == other_ans:
            bonus = True

    if bonus:
        room['players'][my_role]['score'] += 1

    room['history'].append({'question': q, 'answers': {
        my_role: {'nickname': my_name, 'answer': my_ans},
        other_role: {'nickname': other_name, 'answer': other_ans},
    }, 'bonus': bonus})

    icon = '💕' if bonus else '🤔'
    msg = '默契+1！心有灵犀 💕' if bonus else '想法不太一样，也是一种默契～'

    result_html = f"""
    <div style='text-align:center;padding:16px'>
    <div style='font-size:3em'>{icon}</div>
    <div style='font-size:1.2em;font-weight:700;margin:8px 0'>{msg}</div>
    <div style='display:flex;gap:12px;margin-top:16px'>
    <div style='flex:1;background:#fff;border-radius:12px;padding:16px;text-align:center'>
    <div style='font-size:2em'>🐱</div>
    <div style='font-weight:700'>{my_name}</div>
    <div style='color:#7c5cfc;font-weight:600;margin-top:8px'>{my_ans}</div>
    </div>
    <div style='flex:1;background:#fff;border-radius:12px;padding:16px;text-align:center'>
    <div style='font-size:2em'>🐶</div>
    <div style='font-weight:700'>{other_name}</div>
    <div style='color:#7c5cfc;font-weight:600;margin-top:8px'>{other_ans}</div>
    </div>
    </div>
    </div>
    """

    # AI 点评
    ai_text = ''
    if room.get('api_key'):
        try:
            ans = {my_role: {'nickname': my_name, 'answer': my_ans},
                   other_role: {'nickname': other_name, 'answer': other_ans}}
            ai_text = generate_ai_commentary(q, ans, room['api_key'])
        except Exception:
            pass

    return ("第 %d/%d 题结果" % (room['round'], TOTAL_ROUNDS),
            result_html,
            "比分: 👤%d | ❤️%d" % (room['players'][my_role]['score'], room['players'][other_role]['score']),
            gr.update(visible=False), gr.update(visible=False),
            gr.update(value=ai_text, visible=bool(ai_text)),
            gr.update(visible=True))

def next_round_action(player_key, my_role):
    return _next_round(player_key, my_role)

def _finish(rid, my_role):
    room = rooms.get(rid)
    if not room:
        return "结束", "", "", [], gr.update(visible=False), gr.update(), gr.update()
    room['state'] = 'finished'
    other_role = 'guest' if my_role == 'host' else 'host'
    my_score = room['players'][my_role]['score']
    other_score = room['players'].get(other_role, {}).get('score', 0)

    total = my_score + other_score
    VERDICTS = [
        (0, '🌱 缘分正在发芽～'), (1, '🌿 默契慢慢培养中 💕'),
        (2, '🌸 有在认真了解彼此！'), (3, '💐 默契度很高了 💖'),
        (4, '🔥 简直是灵魂伴侣！'), (5, '👑 满分默契！命中注定！'),
    ]
    v = '🎉 挑战结束！'
    for mn, txt in VERDICTS:
        if total >= mn:
            v = txt

    # 历史回顾
    hist_html = '<div style="margin-top:16px"><h3>📋 本局回顾</h3>'
    for i, item in enumerate(room['history']):
        badge = '💕 默契' if item['bonus'] else '🤔 不一样'
        hist_html += '<div style="background:#fff;border-radius:10px;padding:12px;margin:8px 0">'
        hist_html += '<div style="font-weight:600;font-size:14px">%s · %d. %s</div>' % (badge, i + 1, item['question']['q'])
        for r, a in item['answers'].items():
            hist_html += '<div style="font-size:13px;color:#666;margin-top:4px">%s：%s</div>' % (a['nickname'], a['answer'])
        hist_html += '</div>'
    hist_html += '</div>'

    # AI 总结
    ai_text = ''
    if room.get('api_key') and room['history']:
        try:
            ai_text = generate_ai_summary(room['history'], room['players'], room['api_key'])
        except Exception:
            pass

    result_html = f"""
    <div style='text-align:center;padding:20px'>
    <div style='font-size:3em'>🎉</div>
    <div style='font-size:1.3em;font-weight:700;margin:10px 0'>{v}</div>
    <div style='display:flex;gap:12px;margin:16px 0'>
    <div style='flex:1;background:#fff;border-radius:12px;padding:16px'>
    <div style='font-weight:700'>{room['players'][my_role]['nickname']}</div>
    <div style='font-size:2em;color:#ff6b9d;font-weight:800'>{my_score} 分</div>
    </div>
    <div style='flex:1;background:#fff;border-radius:12px;padding:16px'>
    <div style='font-weight:700'>{room['players'].get(other_role, {}).get('nickname', 'TA')}</div>
    <div style='font-size:2em;color:#ff6b9d;font-weight:800'>{other_score} 分</div>
    </div>
    </div>
    {hist_html}
    </div>
    """

    return ("游戏结束！", result_html, v,
            gr.update(visible=False), gr.update(visible=False),
            gr.update(value=ai_text, visible=bool(ai_text)),
            gr.update(visible=True))

def _question_display(room, q):
    label_map = {'who': '谁更可能...', 'choice': '默契选择', 'fill': '默契问答', 'challenge': '⚡ 小挑战'}
    return f"""
    <div style='background:#fff;border-radius:16px;padding:24px;margin:10px 0;box-shadow:0 2px 12px rgba(0,0,0,.06)'>
    <div style='color:#7c5cfc;font-size:12px;font-weight:700;margin-bottom:8px'>{label_map.get(q['type'],'')} · {q.get('category','')}</div>
    <div style='font-size:1.2em;font-weight:600;line-height:1.6'>{q['q']}</div>
    </div>"""

# ===================== Gradio UI 构建 =====================
def build_ui():
    with gr.Blocks(css=CSS, title='情侣默契挑战', theme=gr.themes.Soft()) as demo:
        # 内部状态
        player_key = gr.State('')   # room_id
        player_role = gr.State('')  # 'host' or 'guest'

        with gr.Column(elem_id='main-container'):
            gr.HTML("""
            <div style='text-align:center;padding:20px 0 10px'>
            <div style='font-size:54px'>💞</div>
            <h1 style='margin:8px 0'>情侣默契挑战</h1>
            <p style='color:#999'>抽题 · 答题 · 揭晓 · 默契加分</p>
            </div>""")

            # 步骤 1: 创建/加入
            with gr.Group(visible=True) as setup_group:
                gr.Markdown("### 创建或加入房间")
                with gr.Tabs():
                    with gr.TabItem("创建房间"):
                        create_nick = gr.Textbox(label="你的昵称", placeholder="输入昵称", max_length=10)
                        create_room_name = gr.Textbox(label="房间名", placeholder="甜蜜小屋", max_length=20)
                        create_theme = gr.Dropdown(
                            label="选择主题包",
                            choices=[(v, k) for k, v in THEMES.items()],
                            value='random')
                        create_api_key = gr.Textbox(label="DeepSeek API Key（AI主题需要，其他不用）", type="password", placeholder="sk-...")
                        create_btn = gr.Button("创建房间", variant="primary")
                        create_msg = gr.Markdown("")

                    with gr.TabItem("加入房间"):
                        join_nick = gr.Textbox(label="你的昵称", placeholder="输入昵称", max_length=10)
                        join_room_id = gr.Textbox(label="房间码", placeholder="输入 6 位房间码", max_length=6)
                        join_btn = gr.Button("加入房间", variant="primary")
                        join_msg = gr.Markdown("")

                room_status = gr.HTML("")

            # 步骤 2: 等待/游戏
            with gr.Group(visible=False) as game_group:
                game_status = gr.Markdown("")
                game_header = gr.HTML("")

                start_btn = gr.Button("开始游戏！", variant="primary", visible=False)

                round_title = gr.Markdown("")
                question_html = gr.HTML("")

                choice_radio = gr.Radio(label="选择你的答案", choices=[], visible=False)
                fill_input = gr.Textbox(label="写下你的答案", placeholder="输入答案...", visible=False, max_length=200)
                submit_btn = gr.Button("提交答案", variant="primary", visible=False)

                result_html = gr.HTML("")
                ai_output = gr.Markdown("", visible=False)
                next_btn = gr.Button("下一题 →", variant="primary", visible=False)

            # 结果页
            with gr.Group(visible=False) as finish_group:
                finish_html = gr.HTML("")
                finish_ai = gr.Markdown("", visible=False)
                play_again_btn = gr.Button("再玩一局", variant="primary")

        # ---------- 事件绑定 ----------

        # 创建房间
        def _on_create(n, rn, theme, ak, pk, pr):
            msg, status, gs, cn_up, jo_up, gg_vis, sb_vis = create_room(n, rn, theme, ak)
            new_pk = ''
            new_pr = 'host'
            # parse room_id from status
            import re
            m = re.search(r'房间码.*?([A-Z0-9]{6})', status, re.DOTALL)
            if m:
                new_pk = m.group(1)
            return (msg, status, gs,
                    cn_up, new_pk, new_pr,
                    jo_up, gr.update(), gr.update(),
                    gg_vis, sb_vis,
                    gr.update(), gr.update(), gr.update(), gr.update(),
                    gr.update(), gr.update(), gr.update(),
                    gr.update(visible=False), gr.update(), gr.update())

        create_btn.click(
            _on_create,
            [create_nick, create_room_name, create_theme, create_api_key, player_key, player_role],
            [create_msg, room_status, game_status,
             create_nick, player_key, player_role,
             join_nick, join_room_id, join_msg,
             game_group, start_btn,
             round_title, question_html, choice_radio, fill_input,
             submit_btn, result_html, ai_output,
             finish_group, finish_html, finish_ai]
        )

        # 加入房间
        def _on_join(n, rid, pk, pr):
            msg, status, gs, jn_up, jo_up, gg_vis, sb_vis = join_room(n, rid)
            new_pk = rid.strip().upper() if rid else ''
            new_pr = 'guest'
            return (msg, status, gs,
                    jn_up, new_pk, new_pr,
                    jo_up, gr.update(), gr.update(),
                    gg_vis, sb_vis,
                    gr.update(), gr.update(), gr.update(), gr.update(),
                    gr.update(), gr.update(), gr.update(),
                    gr.update(visible=False), gr.update(), gr.update())

        join_btn.click(
            _on_join,
            [join_nick, join_room_id, player_key, player_role],
            [join_msg, room_status, game_status,
             join_nick, player_key, player_role,
             join_room_id, create_msg, create_nick,
             game_group, start_btn,
             round_title, question_html, choice_radio, fill_input,
             submit_btn, result_html, ai_output,
             finish_group, finish_html, finish_ai]
        )

        # 开始游戏
        def _on_start(pk, pr):
            rt, qh, gs, cr_vis, fi_vis, sb_vis, nb_vis, fh, fa = start_game(pk, pr)
            return (rt, qh, gs, cr_vis, fi_vis, sb_vis, nb_vis,
                    gr.update(), gr.update(), gr.update(),
                    gr.update(visible=False), fh, fa)

        start_btn.click(
            _on_start,
            [player_key, player_role],
            [round_title, question_html, game_status,
             choice_radio, fill_input, submit_btn, next_btn,
             result_html, ai_output, game_header,
             finish_group, finish_html, finish_ai]
        )

        # 提交答案
        def _on_submit(pk, pr, ch, fi):
            rt, qh, gs, cr_vis, fi_vis, ai, nb = submit_answer(pk, pr, ch, fi)
            return (rt, qh, gs, cr_vis, fi_vis, ai, nb,
                    gr.update(), gr.update(), gr.update(),
                    gr.update(visible=False), gr.update(), gr.update())

        submit_btn.click(
            _on_submit,
            [player_key, player_role, choice_radio, fill_input],
            [round_title, question_html, game_status,
             choice_radio, fill_input, ai_output, next_btn,
             submit_btn, result_html, game_header,
             finish_group, finish_html, finish_ai]
        )

        # 下一题
        def _on_next(pk, pr):
            rt, qh, gs, cr_vis, fi_vis, ai, nb = next_round_action(pk, pr)
            return (rt, qh, gs, cr_vis, fi_vis,
                    gr.update(visible=True), nb, ai,
                    gr.update(), gr.update(), gr.update(),
                    gr.update(visible=False), gr.update(), gr.update())

        next_btn.click(
            _on_next,
            [player_key, player_role],
            [round_title, question_html, game_status,
             choice_radio, fill_input,
             submit_btn, next_btn, ai_output,
             result_html, game_header, room_status,
             finish_group, finish_html, finish_ai]
        )

        # 再玩一局
        def _on_again(pk, pr):
            rid = pk.strip().upper()
            room = rooms.get(rid)
            if room:
                room['state'] = 'waiting'
                room['round'] = 0
                room['answers'] = {}
                room['history'] = []
                room['used_qs'] = []
                for p in room['players'].values():
                    p['score'] = 0
            return (gr.update(visible=True), gr.update(visible=False),
                    gr.update(value=""), gr.update(), gr.update(),
                    gr.update(), gr.update(), gr.update(),
                    gr.update(), gr.update(), gr.update())

        play_again_btn.click(
            _on_again,
            [player_key, player_role],
            [game_group, finish_group,
             room_status,
             round_title, question_html, choice_radio, fill_input,
             submit_btn, result_html, ai_output,
             start_btn, next_btn, game_header]
        )

    return demo

app_ui = build_ui()

if __name__ == '__main__':
    PORT = int(os.environ.get('PORT', 7860))
    app_ui.queue(default_concurrency_limit=100).launch(
        server_name='0.0.0.0', server_port=PORT, share=False)
