/* 中医体质数据层（二）：健康打卡习惯清单
 * 设计原则：颗粒度小（3 分钟内可完成）、有明确触发点、可持续不靠意志力
 * tag: routine 作息 / diet 饮食 / exercise 运动 / emotion 情志 / care 保健
 */

const COMMON_HABITS = [
  { id: 'c1', text: '晨起空腹一杯温水（200 毫升）', tag: 'diet', freq: 'daily', why: '温养脾胃，唤醒肠道蠕动' },
  { id: 'c2', text: '三餐定时，晚餐距入睡 3 小时以上', tag: 'diet', freq: 'daily', why: '脾胃喜规律，忌夜食伤脾' },
  { id: 'c3', text: '23:00 前上床，手机不带进卧室', tag: 'routine', freq: 'daily', why: '子时胆经当令，睡眠是最有效的调养' },
  { id: 'c4', text: '日行 6000 步以上，久坐 45 分钟即起身', tag: 'exercise', freq: 'daily', why: '久坐伤肉，动则气血流通' }
];

const HABITS = {
  pinghe: [
    { id: 'ph1', text: '晨起搓手熨目 1 分钟，再喝温水', tag: 'routine', freq: 'daily', why: '醒神明目，和缓启动一天' },
    { id: 'ph2', text: '每餐七八分饱，先菜后肉再主食', tag: 'diet', freq: 'daily', why: '保持中焦运化有余地' },
    { id: 'ph3', text: '一套八段锦或 20 分钟快走', tag: 'exercise', freq: 'daily', why: '形劳而不倦，维持气血流通' },
    { id: 'ph4', text: '午间闭目养神 15 分钟', tag: 'routine', freq: 'daily', why: '敛神养气，下午精力更稳' },
    { id: 'ph5', text: '每周一次亲近自然的户外活动', tag: 'emotion', freq: 'weekly', why: '疏解压力，维持情志平和' },
    { id: 'ph6', text: '睡前热水泡脚 10 分钟', tag: 'routine', freq: 'daily', why: '引火归元，改善入睡' },
    { id: 'ph7', text: '按揉足三里每侧 2 分钟', tag: 'care', freq: 'daily', why: '健脾保健，长寿要穴' },
    { id: 'ph8', text: '记录一件今日感恩的小事', tag: 'emotion', freq: 'daily', why: '正向情绪是平和质的护城河' }
  ],
  qixu: [
    { id: 'qx1', text: '晨起一杯姜枣茶（生姜 2 片 + 大枣 2 枚）', tag: 'diet', freq: 'daily', why: '温中益气，简单有效' },
    { id: 'qx2', text: '早餐必有热食，拒绝冰饮与生冷', tag: 'diet', freq: 'daily', why: '寒凉最伤脾阳，气虚者尤忌' },
    { id: 'qx3', text: '午间闭目养神 20 至 30 分钟', tag: 'routine', freq: 'daily', why: '敛气复元，避免下午气陷乏力' },
    { id: 'qx4', text: '23:00 前入睡，保证 7 至 8 小时', tag: 'routine', freq: 'daily', why: '睡眠是补气最省力的方式' },
    { id: 'qx5', text: '八段锦"两手托天理三焦"连做 3 遍', tag: 'exercise', freq: 'daily', why: '升提气机，不耗气' },
    { id: 'qx6', text: '缓步散步 20 分钟，微汗即止', tag: 'exercise', freq: 'daily', why: '大汗伤气，微汗最宜' },
    { id: 'qx7', text: '写下今日一件完成的小事', tag: 'emotion', freq: 'daily', why: '减少自我消耗，思虑最伤脾' },
    { id: 'qx8', text: '按揉或温灸足三里每侧 3 分钟', tag: 'care', freq: 'daily', why: '健脾益气第一要穴' }
  ],
  yangxu: [
    { id: 'yx1', text: '晒太阳 15 分钟（背朝太阳，摘帽）', tag: 'routine', freq: 'daily', why: '背为阳，晒背是最天然的补阳法' },
    { id: 'yx2', text: '睡前热水泡脚 15 分钟（可加艾叶或生姜）', tag: 'routine', freq: 'daily', why: '暖足即暖全身，助阳入阴' },
    { id: 'yx3', text: '晨起一杯姜枣茶', tag: 'diet', freq: 'daily', why: '温阳散寒，从早晨开始' },
    { id: 'yx4', text: '全天不碰冰饮与寒凉瓜果', tag: 'diet', freq: 'daily', why: '寒凉直折脾肾阳气' },
    { id: 'yx5', text: '快走或慢跑 30 分钟，身体暖透为止', tag: 'exercise', freq: 'daily', why: '动能生阳，宜在日光下' },
    { id: 'yx6', text: '护好腰腹膝踝，空调不低于 26℃', tag: 'routine', freq: 'daily', why: '寒从脚下生，风寒从背后入' },
    { id: 'yx7', text: '每天安排一件让自己开心的小事', tag: 'emotion', freq: 'daily', why: '喜则气缓、阳气升发' },
    { id: 'yx8', text: '温灸关元或命门 10 分钟', tag: 'care', freq: 'weekly', why: '温补下元，补肾阳之根本' }
  ],
  yinxu: [
    { id: 'yin1', text: '23:00 前入睡，绝不熬夜', tag: 'routine', freq: 'daily', why: '夜属阴，熬夜直接耗伤阴液' },
    { id: 'yin2', text: '午间小憩 15 至 20 分钟', tag: 'routine', freq: 'daily', why: '静能生水，养阴以静为贵' },
    { id: 'yin3', text: '一份滋阴食材入膳（银耳/百合/梨/藕）', tag: 'diet', freq: 'daily', why: '甘凉滋润，濡养阴液' },
    { id: 'yin4', text: '不碰辛辣烧烤与烈酒', tag: 'diet', freq: 'daily', why: '辛温燥热最劫阴津' },
    { id: 'yin5', text: '游泳或舒缓瑜伽 30 分钟，微汗即止', tag: 'exercise', freq: 'daily', why: '大汗伤津，阴虚忌大汗' },
    { id: 'yin6', text: '用眼 40 分钟后远眺 5 分钟', tag: 'routine', freq: 'daily', why: '久视伤血，血伤则阴亏' },
    { id: 'yin7', text: '睡前 1 小时远离手机与激烈讨论', tag: 'emotion', freq: 'daily', why: '收摄心神，减少虚火扰动' },
    { id: 'yin8', text: '按揉太溪与三阴交各 3 分钟', tag: 'care', freq: 'daily', why: '滋补肾阴，引虚火下行' }
  ],
  tanshi: [
    { id: 'ts1', text: '7:00 前起床，不睡回笼觉', tag: 'routine', freq: 'daily', why: '久卧伤气，贪睡助湿' },
    { id: 'ts2', text: '有氧运动 40 分钟，出汗为止', tag: 'exercise', freq: 'daily', why: '动则生阳，化湿必须出汗' },
    { id: 'ts3', text: '日行 8000 步，久坐不超 45 分钟', tag: 'exercise', freq: 'daily', why: '久坐加重气滞湿阻' },
    { id: 'ts4', text: '零甜食零含糖饮料', tag: 'diet', freq: 'daily', why: '甜腻最易生痰，是痰湿首忌' },
    { id: 'ts5', text: '一碗薏米赤小豆粥或陈皮茯苓茶', tag: 'diet', freq: 'daily', why: '健脾利湿，化痰浊' },
    { id: 'ts6', text: '晚餐七分饱且 19:00 前完成', tag: 'diet', freq: 'daily', why: '夜食积滞，脾运不及则生痰' },
    { id: 'ts7', text: '记录体重与腰围，每周一次', tag: 'routine', freq: 'weekly', why: '化痰祛湿的核心指标是腰围' },
    { id: 'ts8', text: '按揉丰隆穴每侧 5 分钟', tag: 'care', freq: 'daily', why: '化痰第一要穴' }
  ],
  shire: [
    { id: 'sr1', text: '有氧运动 40 至 60 分钟，明显出汗', tag: 'exercise', freq: 'daily', why: '让湿热从汗而解' },
    { id: 'sr2', text: '清淡饮食，零烧烤零油炸', tag: 'diet', freq: 'daily', why: '肥甘厚味助湿生热' },
    { id: 'sr3', text: '一碗绿豆薏米汤或苦瓜入膳', tag: 'diet', freq: 'daily', why: '清热利湿，分消走泄' },
    { id: 'sr4', text: '不饮酒，尤其啤酒与烈酒', tag: 'diet', freq: 'daily', why: '酒为湿热之最' },
    { id: 'sr5', text: '饮水 1800 毫升以上，保持二便通', tag: 'diet', freq: 'daily', why: '给湿热以出路' },
    { id: 'sr6', text: '23:00 前入睡，熬夜必助火', tag: 'routine', freq: 'daily', why: '熬夜耗阴，阴虚则火旺' },
    { id: 'sr7', text: '遇事先离开现场冷静 3 分钟', tag: 'emotion', freq: 'daily', why: '气有余便是火，怒助火势' },
    { id: 'sr8', text: '按揉曲池与阴陵泉各 3 分钟', tag: 'care', freq: 'daily', why: '清热利湿的经典配穴' }
  ],
  xueyu: [
    { id: 'xy1', text: '快走或慢跑 30 分钟，微微出汗', tag: 'exercise', freq: 'daily', why: '流水不腐，血以通为补' },
    { id: 'xy2', text: '舒展拉伸与扩胸运动 5 分钟', tag: 'exercise', freq: 'daily', why: '气行则血行，先通其气' },
    { id: 'xy3', text: '一份活血食材入膳（山楂/黑木耳/洋葱）', tag: 'diet', freq: 'daily', why: '活血化瘀，软化血脉' },
    { id: 'xy4', text: '不碰冰饮，腰腹四肢保暖', tag: 'routine', freq: 'daily', why: '血得寒则凝，得温则行' },
    { id: 'xy5', text: '久坐 45 分钟必起身活动', tag: 'routine', freq: 'daily', why: '久坐伤肉，气滞则血瘀' },
    { id: 'xy6', text: '睡前泡脚 10 分钟（可加红花或艾叶）', tag: 'routine', freq: 'daily', why: '温通血脉，改善末梢循环' },
    { id: 'xy7', text: '主动表达情绪，不把话憋在心里', tag: 'emotion', freq: 'daily', why: '气郁则血滞，情志舒畅是化瘀前提' },
    { id: 'xy8', text: '按揉血海与三阴交各 3 分钟', tag: 'care', freq: 'daily', why: '活血养血，调血要穴' }
  ],
  qiyu: [
    { id: 'qy1', text: '户外光照 30 分钟（散步或通勤步行）', tag: 'routine', freq: 'daily', why: '阳光与开阔视野最能疏肝解郁' },
    { id: 'qy2', text: '一杯玫瑰佛手茶，午后饮用', tag: 'diet', freq: 'daily', why: '疏肝理气，芳香解郁' },
    { id: 'qy3', text: '晨起舒展操或扩胸运动 5 分钟', tag: 'exercise', freq: 'daily', why: '舒展肝胆经，条达气机' },
    { id: 'qy4', text: '每周 3 次集体或户外运动', tag: 'exercise', freq: 'weekly', why: '集体运动兼顾社交与解郁' },
    { id: 'qy5', text: '写三行情绪日记，或向人倾诉一次', tag: 'emotion', freq: 'daily', why: '郁则发之，情绪必须有出口' },
    { id: 'qy6', text: '固定作息，起床与入睡时间不变', tag: 'routine', freq: 'daily', why: '节律紊乱会直接加重气郁' },
    { id: 'qy7', text: '主动安排一件令人期待的小事', tag: 'emotion', freq: 'weekly', why: '喜胜悲，以喜解郁' },
    { id: 'qy8', text: '按揉太冲与膻中各 3 分钟', tag: 'care', freq: 'daily', why: '疏肝理气、宽胸解郁' }
  ],
  tebing: [
    { id: 'tb1', text: '更换并晾晒枕巾被套（每周 2 次）', tag: 'routine', freq: 'weekly', why: '防螨防尘，减少接触性诱因' },
    { id: 'tb2', text: '花粉季外出戴口罩，回家洗脸冲鼻腔', tag: 'routine', freq: 'daily', why: '物理阻隔是最有效的防敏手段' },
    { id: 'tb3', text: '记录今日饮食与身体反应', tag: 'diet', freq: 'daily', why: '逐步锁定过敏原，替代盲目忌口' },
    { id: 'tb4', text: '山药或大枣入膳一次', tag: 'diet', freq: 'daily', why: '健脾益气固表，改善过敏体质' },
    { id: 'tb5', text: '规律有氧 30 分钟，室内为主', tag: 'exercise', freq: 'daily', why: '改善免疫调节，避开过敏原高峰' },
    { id: 'tb6', text: '腹式呼吸训练 5 分钟', tag: 'emotion', freq: 'daily', why: '降低紧张水平，紧张可诱发发作' },
    { id: 'tb7', text: '23:00 前入睡，睡眠充足', tag: 'routine', freq: 'daily', why: '免疫紊乱常与睡眠不足相伴' },
    { id: 'tb8', text: '按揉足三里与曲池各 3 分钟', tag: 'care', freq: 'daily', why: '益气固表、疏风止痒' }
  ]
};

const TAG_META = {
  routine: { label: '作息', color: '#5B8291' },
  diet: { label: '饮食', color: '#C08A3E' },
  exercise: { label: '运动', color: '#7C9A6B' },
  emotion: { label: '情志', color: '#7A6BA8' },
  care: { label: '保健', color: '#A6432E' }
};
