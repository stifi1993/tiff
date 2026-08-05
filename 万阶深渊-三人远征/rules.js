(() => {
  "use strict";

  const MAX_STAGE = 10000;
  const OFFLINE_CAP = 12 * 60 * 60;
  const ENEMY_HP_GROWTH = 1.001065;
  const ENEMY_ATK_GROWTH = 1.0006;
  const XP_GROWTH = 1.0565;

  const ZONES = [
    { name: "苔痕地窟", boss: "苔岩巨魔", desc: "盘踞在潮湿石窟中的远古巨兽。", enemies: ["洞穴黏怪", "苔甲鼠", "石牙蝠"], hue: "#59774b" },
    { name: "废弃矿井", boss: "钢甲虫王", desc: "吞噬矿脉、披覆钢甲的虫群主宰。", enemies: ["矿镐傀儡", "铁壳甲虫", "幽灯矿工"], hue: "#b17a3d" },
    { name: "亡魂墓穴", boss: "亡灵巫妖", desc: "以千年亡魂维系不朽王冠。", enemies: ["墓穴骷髅", "缚魂幽灵", "腐朽守卫"], hue: "#7b63a6" },
    { name: "熔火锻炉", boss: "熔炉魔像", desc: "远古锻炉中永不停息的熔火核心。", enemies: ["熔岩幼体", "锻炉恶犬", "火炭傀儡"], hue: "#d75c36" },
    { name: "水晶深渊", boss: "水晶九头蛇", desc: "每颗头颅都折射着致命晶光。", enemies: ["晶簇爬虫", "辉光水母", "镜甲蜥蜴"], hue: "#48a9b5" },
    { name: "腐毒下水道", boss: "腐毒憎恶", desc: "由炼金废液与遗骸缝合而成。", enemies: ["毒囊蛙", "疫病鼠王", "污泥行者"], hue: "#7d9b43" },
    { name: "永冻王陵", boss: "冰冠亡王", desc: "冻土王座上的最后一位守墓人。", enemies: ["霜骨兵", "冰晶女妖", "雪墓骑士"], hue: "#72a9d6" },
    { name: "虚空监牢", boss: "虚空狱卒", desc: "看守现实裂隙的无面执刑者。", enemies: ["裂隙之眼", "锁链幽影", "虚空囚徒"], hue: "#855fc6" },
    { name: "龙骨禁区", boss: "龙骨君主", desc: "披挂万龙遗骨的深渊领主。", enemies: ["骨翼幼龙", "龙墓祭司", "骸骨巨蜥"], hue: "#c9a567" },
    { name: "魔王王座", boss: "深渊魔王", desc: "万阶尽头，等待篝火熄灭。", enemies: ["深渊侍从", "魔眼骑士", "王座执事"], hue: "#bb476d" }
  ];
  const EVOLUTIONS = ["初生体", "坚甲体", "狂暴体", "魔能体", "领主形态", "灾厄形态", "深渊形态", "王冠形态", "灭世形态", "终焉形态"];
  const BOSS_MECHANICS = [
    { name: "撼地", desc: "每4次攻击震击全队" }, { name: "钢壳", desc: "开战时以甲壳抵挡前几次伤害" },
    { name: "噬魂", desc: "周期性吸取生命恢复自身" }, { name: "熔怒", desc: "生命低于40%后攻击加速并增伤" },
    { name: "多首", desc: "周期性同时撕咬两名队员" }, { name: "腐毒", desc: "攻击叠加腐蚀，使目标承伤提高" },
    { name: "冰封", desc: "周期性冻结暗影游侠的行动" }, { name: "禁魔", desc: "周期性抽取全队终极技能能量" },
    { name: "龙威", desc: "对低生命目标造成更高伤害" }, { name: "终焉", desc: "以深渊护盾开战并周期性轰击全队" }
  ];
  const HERO_DEFS = [
    { id: "yutong", name: "王宇彤", role: "铁壁守卫", roleClass: "tank", baseHp: 280, baseAtk: 11, baseDef: 15, interval: 1.25, color: "#e1b35b", skills: ["盾击", "守护壁垒", "威慑嘲讽", "不落城塞"] },
    { id: "wangshang", name: "王尚", role: "暗影游侠", roleClass: "dps", baseHp: 135, baseAtk: 25, baseDef: 6, interval: .78, color: "#e7606c", skills: ["弩射", "暗影连击", "弱点标记", "百矢夜幕"] },
    { id: "chongrui", name: "徐崇睿", role: "星辉祭司", roleClass: "support", baseHp: 170, baseAtk: 10, baseDef: 8, interval: 1.4, color: "#6edbd0", skills: ["星光弹", "星辉治愈", "勇气祝福", "命运回响"] }
  ];
  const BONFIRE_NODE_TYPES = ["attack", "vitality", "gold", "xp", "gear", "all"];
  const BONFIRE_NODE_NAMES = { attack: "锋芒", vitality: "坚韧", gold: "丰饶", xp: "启悟", gear: "寻宝", all: "恒火" };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const zoneOf = stage => clamp(Math.floor((stage - 1) / 1000), 0, 9);
  const bossEvolution = stage => clamp(Math.ceil(((stage - 1) % 1000 + 1) / 100) - 1, 0, 9);
  const xpNeeded = level => 55 * Math.pow(XP_GROWTH, level - 1);
  const skillEvolutionTier = level => level >= 200 ? 2 : level >= 100 ? 1 : 0;
  const enemyStats = stage => {
    const zoneIndex = zoneOf(stage), boss = stage % 100 === 0, elite = !boss && stage % 10 === 0;
    const power = Math.pow(ENEMY_HP_GROWTH, stage - 1) * (1 + zoneIndex * .42);
    return {
      boss, elite, zoneIndex, evo: bossEvolution(stage), enemyType: (stage - 1) % 3,
      hp: 115 * power * (boss ? 17 : elite ? 3.1 : 1),
      atk: 10 * Math.pow(ENEMY_ATK_GROWTH, stage - 1) * (boss ? 2.8 : elite ? 1.5 : 1),
      limit: boss ? 30 : 12
    };
  };

  globalThis.AbyssRules = Object.freeze({
    MAX_STAGE, OFFLINE_CAP, ENEMY_HP_GROWTH, ENEMY_ATK_GROWTH, XP_GROWTH,
    ZONES, EVOLUTIONS, BOSS_MECHANICS, HERO_DEFS, BONFIRE_NODE_TYPES, BONFIRE_NODE_NAMES,
    clamp, zoneOf, bossEvolution, xpNeeded, skillEvolutionTier, enemyStats
  });
})();
