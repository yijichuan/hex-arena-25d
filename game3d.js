import * as THREE from "./vendor-three.module.min.js";

const championAssetRoot = "https://ddragon.leagueoflegends.com/cdn/14.24.1/img/champion/";

const canvas = document.getElementById("game3d");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();
scene.background = new THREE.Color("#07131f");
scene.fog = new THREE.FogExp2("#0a1a28", 0.012);
const camera = new THREE.OrthographicCamera(-18, 18, 12, -12, 0.1, 500);
camera.position.set(-72, 30, 30);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const movePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const pointerWorld = new THREE.Vector3(0, 0, 0);
const keys = new Set();
const units = [];
const structures = [];
const projectiles = [];
const effects = [];
const floaters = [];
const feed = ["3D 极地裂隙已加载。", "清理兵线并推进到敌方核心枢纽。"];
const world = { minX: -116, maxX: 116, halfWidth: 10 };
const spawnPoints = { blue: { x: -108, z: 0, visual: null }, red: { x: 108, z: 0, visual: null } };
let elapsed = 0;
let waveTimer = 1;
let hordeTimer = 4;
let relicTimer = 0;
let toastTimer = 0;
let blueKills = 0;
let redKills = 0;
let gameOver = false;
let victory = false;
let paused = false;
let moveTarget = null;

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function distance(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
function alive(entity) { return entity && entity.hp > 0 && !(entity.respawn > 0); }
function enemyOf(team, entity) { return entity && entity.team && entity.team !== team; }
function colorFor(team) { return team === "blue" ? 0x6fdcff : 0xff6687; }
function hex(color) { return `#${color.toString(16).padStart(6, "0")}`; }

function makeTexture(painter, repeatX = 1, repeatY = 1) {
  const image = document.createElement("canvas");
  image.width = 256; image.height = 256;
  const context = image.getContext("2d");
  painter(context, image.width, image.height);
  const texture = new THREE.CanvasTexture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  return texture;
}

const iceTexture = makeTexture((c, w, h) => {
  const gradient = c.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, "#9bd2e8"); gradient.addColorStop(.48, "#d9f6fa"); gradient.addColorStop(1, "#75b6d1");
  c.fillStyle = gradient; c.fillRect(0, 0, w, h);
  c.globalAlpha = .24; c.strokeStyle = "#3a89aa"; c.lineWidth = 2;
  for (let i = -3; i < 9; i++) { c.beginPath(); c.moveTo(i * 42, 0); c.lineTo(i * 42 + 35, h); c.stroke(); }
  c.globalAlpha = .5; c.strokeStyle = "#f6ffff"; c.lineWidth = 1;
  for (let i = 0; i < 28; i++) { const x = (i * 73) % w; const y = (i * 113) % h; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 8, y + 5); c.lineTo(x + 15, y - 2); c.stroke(); }
}, 10, 1);
const waterTexture = makeTexture((c, w, h) => {
  c.fillStyle = "#123b50"; c.fillRect(0, 0, w, h); c.strokeStyle = "rgba(107,226,255,.25)"; c.lineWidth = 2;
  for (let y = 4; y < h; y += 18) { c.beginPath(); for (let x = 0; x <= w; x += 24) c.lineTo(x, y + Math.sin(x * .08 + y) * 4); c.stroke(); }
}, 8, 5);
const snowTexture = makeTexture((c, w, h) => {
  c.fillStyle = "#eefcff"; c.fillRect(0, 0, w, h); c.fillStyle = "rgba(119,186,210,.22)";
  for (let i = 0; i < 60; i++) { c.beginPath(); c.arc((i * 59) % w, (i * 97) % h, 2 + i % 4, 0, Math.PI * 2); c.fill(); }
}, 5, 2);
const glowTexture = makeTexture((c, w, h) => {
  const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(.22, "rgba(191,243,255,.8)"); g.addColorStop(1, "rgba(88,175,255,0)"); c.fillStyle = g; c.fillRect(0, 0, w, h);
}, 1, 1);

scene.add(new THREE.HemisphereLight(0xbcecff, 0x07101e, 1.65));
const keyLight = new THREE.DirectionalLight(0xdaf6ff, 2.8);
keyLight.position.set(-30, 60, 25); keyLight.castShadow = true; keyLight.shadow.mapSize.set(2048, 2048); scene.add(keyLight);
const rimLight = new THREE.PointLight(0x2b97d2, 16, 80, 2); rimLight.position.set(0, 10, 0); scene.add(rimLight);

function addWorld() {
  const water = new THREE.Mesh(new THREE.PlaneGeometry(320, 110), new THREE.MeshStandardMaterial({ map: waterTexture, color: 0x6ebcd0, roughness: .35, metalness: .25 }));
  water.rotation.x = -Math.PI / 2; water.position.y = -3.5; water.receiveShadow = true; scene.add(water);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(240, 2, 20), new THREE.MeshStandardMaterial({ map: iceTexture, color: 0xc5f4ff, roughness: .82, metalness: .1 }));
  bridge.position.y = -1; bridge.receiveShadow = true; scene.add(bridge);
  const snowBankMat = new THREE.MeshStandardMaterial({ map: snowTexture, color: 0xffffff, roughness: .88 });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x4b7890, roughness: .93 });
  for (let x = -116; x <= 116; x += 7) {
    for (const z of [-11.2, 11.2]) {
      const bank = new THREE.Mesh(new THREE.DodecahedronGeometry(1.4 + (Math.abs(x) % 3) * .28, 0), snowBankMat);
      bank.position.set(x, -.05, z); bank.scale.y = .6; bank.rotation.y = x * .3; bank.castShadow = true; scene.add(bank);
      const spike = new THREE.Mesh(new THREE.ConeGeometry(.32 + (x % 2) * .1, 3 + (Math.abs(x) % 4), 6), rockMat);
      spike.position.set(x + 1.7, 1, z * .94); spike.castShadow = true; scene.add(spike);
    }
  }
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0x9bdfff, transparent: true, opacity: .24, blending: THREE.AdditiveBlending, depthWrite: false }));
  moon.position.set(0, 38, -44); moon.scale.set(45, 45, 1); scene.add(moon);
  for (let i = 0; i < 120; i++) {
    const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: i % 4 ? 0x9adfff : 0xffd98b, transparent: true, opacity: .2 + (i % 4) * .08, depthWrite: false, blending: THREE.AdditiveBlending }));
    star.position.set(-150 + (i * 37) % 300, 12 + (i * 17) % 35, -48 - (i % 8) * 3); star.scale.setScalar(.12 + (i % 3) * .08); scene.add(star);
  }
}
addWorld();

const player = {
  kind: "player", team: "blue", championId: "Ashe", role: "ranged", name: "寒冰射手", abilityNames: ["射手专注", "万箭齐发", "鹰击长空", "水晶箭"], x: -104, z: 0, hp: 680, maxHp: 680, mana: 360, maxMana: 360,
  level: 1, xp: 0, nextXp: 500, speed: 15, attackTimer: 0, respawn: 0, shield: 0, stun: 0, pendingUpgrades: 0, gold: 800, items: [], combatTimer: 0, shopPending: false, shopReason: "",
  cds: { q: 0, w: 0, e: 0, r: 0 },
  build: { qDamageMult: 1, qBounce: false, wShieldBonus: 0, wCooldownMult: 1, eRadius: 0, eDamageMult: 1, eFreeze: false, rDamageMult: 1, rRadius: 0, autoDamage: 0, allDamageMult: 1, structureDamage: 1, manaRegen: 8, relicPower: 1, lowHealthBonus: 0, hpOnKill: 0 },
  augments: [], visual: null
};

const championPool = [
  { id: "MasterYi", name: "无极剑圣", role: "战士", roleId: "melee", hp: 780, mana: 300, speed: 17, description: "近战收割，冲入人群后持续追击。", skills: ["阿尔法突袭", "冥想", "无极剑道", "高原血统"] },
  { id: "Ashe", name: "寒冰射手", role: "射手", roleId: "ranged", hp: 680, mana: 360, speed: 15, description: "远程减速，箭雨覆盖整条冰桥。", skills: ["射手专注", "万箭齐发", "鹰击长空", "水晶箭"] },
  { id: "Garen", name: "德玛西亚之力", role: "战士", roleId: "melee", hp: 860, mana: 300, speed: 14, description: "坚韧前排，靠旋转和斩杀推进。", skills: ["致命打击", "勇气", "审判", "德玛西亚正义"] },
  { id: "Lux", name: "光辉女郎", role: "法师", roleId: "mage", hp: 640, mana: 420, speed: 14, description: "远程爆发，适合叠加技能强化。", skills: ["光之束缚", "曲光屏障", "透光奇点", "终极闪光"] },
  { id: "Ezreal", name: "探险家", role: "射手", roleId: "ranged", hp: 690, mana: 390, speed: 16, description: "灵活风筝，连续命中可以快速清场。", skills: ["秘术射击", "精华跃动", "奥术跃迁", "精准弹幕"] },
  { id: "Blitzcrank", name: "蒸汽机器人", role: "坦克", roleId: "tank", hp: 920, mana: 320, speed: 13, description: "高耐久控制，适合护盾与范围强化。", skills: ["机械飞爪", "过载运转", "能量铁拳", "静电力场"] },
  { id: "Jinx", name: "祖安花火", role: "射手", roleId: "ranged", hp: 700, mana: 340, speed: 15, description: "攻速成长，击杀后进入狂热状态。", skills: ["砰砰枪", "震荡电磁波", "嚼火者", "超级死亡火箭"] },
  { id: "Morgana", name: "堕落天使", role: "法师", roleId: "mage", hp: 730, mana: 400, speed: 14, description: "持续伤害和禁锢，擅长控制潮群。", skills: ["暗之禁锢", "黑暗之盾", "折磨之影", "灵魂镣铐"] }
];

const augmentPool = [
  { id: "arcane_echo", name: "奥术回响", rarity: "gold", desc: "Q 伤害提高 28%，命中后会对附近第二个目标弹射。", apply: () => { player.build.qDamageMult += .28; player.build.qBounce = true; } },
  { id: "glacial_domain", name: "冰川领域", rarity: "silver", desc: "E 范围扩大，命中的敌人被短暂冻结。", apply: () => { player.build.eRadius += 2.8; player.build.eFreeze = true; } },
  { id: "fortress_prism", name: "棱彩堡垒", rarity: "gold", desc: "W 护盾提高 130，冷却时间缩短 15%。", apply: () => { player.build.wShieldBonus += 130; player.build.wCooldownMult *= .85; } },
  { id: "starfall_core", name: "星落核心", rarity: "prismatic", desc: "R 伤害提高 50%，落点半径扩大。", apply: () => { player.build.rDamageMult += .5; player.build.rRadius += 2.3; } },
  { id: "snowball_reactor", name: "雪球反应堆", rarity: "silver", desc: "自动攻击伤害提高 20，并产生更强的冰晶弹道。", apply: () => { player.build.autoDamage += 20; } },
  { id: "soul_furnace", name: "灵魂熔炉", rarity: "gold", desc: "最大生命值提高 180，击杀单位回复生命。", apply: () => { player.maxHp += 180; player.hp = player.maxHp; player.build.hpOnKill += 55; } },
  { id: "relic_overcharge", name: "圣坛过载", rarity: "silver", desc: "治疗圣坛的治疗与法力恢复提高 65%。", apply: () => { player.build.relicPower += .65; } },
  { id: "hextech_breach", name: "海克斯破城", rarity: "prismatic", desc: "对炮塔、抑制器、门牙塔和核心枢纽的伤害提高 35%。", apply: () => { player.build.structureDamage += .35; } },
  { id: "mana_battery", name: "法力电池", rarity: "silver", desc: "法力回复提高 6，所有技能冷却速度提高 8%。", apply: () => { player.build.manaRegen += 6; } },
  { id: "glass_cannon", name: "玻璃大炮", rarity: "gold", desc: "所有伤害提高 18%，最大生命值降低 90。", apply: () => { player.build.allDamageMult += .18; player.maxHp = Math.max(300, player.maxHp - 90); player.hp = Math.min(player.hp, player.maxHp); } },
  { id: "blizzard_heart", name: "暴雪之心", rarity: "prismatic", desc: "E 伤害提高 40%，冻结时间延长。", apply: () => { player.build.eDamageMult += .4; player.build.eFreeze = true; } },
  { id: "last_stand", name: "背水一战", rarity: "gold", desc: "生命值低于 40% 时，所有伤害提高 35%。", apply: () => { player.build.lowHealthBonus += .35; } }
];

const shopItems = [
  { id: "potion", name: "海克斯治疗药水", cost: 180, desc: "立即回复 45% 最大生命值，并获得 90 秒再生效果。", buy: () => { player.hp = Math.min(player.maxHp, player.hp + player.maxHp * .45); } },
  { id: "ether", name: "法力乙醚", cost: 160, desc: "立即回复法力，并永久提高 90 最大法力。", buy: () => { player.maxMana += 90; player.mana = player.maxMana; } },
  { id: "swift_boots", name: "霜痕疾行靴", cost: 350, desc: "永久提高 2.5 移速，提升在冰桥上的走位手感。", buy: () => { player.speed += 2.5; } },
  { id: "arcane_focus", name: "奥术聚焦器", cost: 520, desc: "所有技能伤害提高 12%，法力回复提高 3。", buy: () => { player.build.allDamageMult += .12; player.build.manaRegen += 3; } },
  { id: "siege_lens", name: "破城棱镜", cost: 480, desc: "对全部构筑物的伤害额外提高 18%。", buy: () => { player.build.structureDamage += .18; } },
  { id: "hextech_core", name: "不稳定海克斯核心", cost: 700, desc: "最大生命值与法力各提高 140，并强化下一次升级。", buy: () => { player.maxHp += 140; player.maxMana += 140; player.hp = player.maxHp; player.mana = player.maxMana; } }
];

function addFeed(message, color = "") { feed.unshift({ text: message, color }); feed.splice(4); }
function notify(message) { const toast = document.getElementById("toast"); toast.textContent = message; toast.classList.add("show"); toastTimer = 2.3; }
function addText(text, position, color = "#baf3ff") { floaters.push({ text, position: position.clone(), life: .85, color }); }

function createCrystal(color, scale = 1) {
  const group = new THREE.Group();
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.05 * scale, 1), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4, roughness: .18, metalness: .35, transparent: true, opacity: .9 }));
  core.castShadow = true; group.add(core);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(1.45 * scale, .045, 8, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .7, blending: THREE.AdditiveBlending }));
  halo.rotation.x = Math.PI / 2; group.add(halo); group.userData.halo = halo;
  const light = new THREE.PointLight(color, 3.5 * scale, 12); light.position.y = 1; group.add(light);
  return group;
}

function createSpawnPoint(team) {
  const point = spawnPoints[team]; const teamColor = colorFor(team); const group = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 4.4, .28, 12), new THREE.MeshStandardMaterial({ color: team === "blue" ? 0x143c62 : 0x5c203e, emissive: teamColor, emissiveIntensity: .5, metalness: .7, roughness: .28 })); pad.position.y = .14; group.add(pad);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.7, .16, 10, 48), new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: .85, blending: THREE.AdditiveBlending })); ring.rotation.x = Math.PI / 2; ring.position.y = .38; group.add(ring); group.userData.ring = ring;
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(.18, .65, 4.2, 6), new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: .24, blending: THREE.AdditiveBlending })); beacon.position.y = 2.3; group.add(beacon);
  group.position.set(point.x, 0, point.z); scene.add(group); point.visual = group;
  const shop = new THREE.Group(); const counter = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.1, 1.2), new THREE.MeshStandardMaterial({ color: 0x7a5134, roughness: .8 })); counter.position.y = .55; shop.add(counter); const sign = new THREE.Mesh(new THREE.BoxGeometry(1.8, .9, .12), new THREE.MeshBasicMaterial({ color: 0xffd47f, transparent: true, opacity: .84 })); sign.position.set(0, 2, .1); shop.add(sign); shop.position.set(point.x, 0, point.z - 5); scene.add(shop); point.shop = shop;
}
createSpawnPoint("blue"); createSpawnPoint("red");

function createStructureVisual(structure) {
  const group = new THREE.Group();
  const teamColor = colorFor(structure.team);
  const baseMat = new THREE.MeshStandardMaterial({ color: structure.team === "blue" ? 0x17486a : 0x63243e, roughness: .64, metalness: .35 });
  const metalMat = new THREE.MeshStandardMaterial({ color: structure.team === "blue" ? 0x8cd8e9 : 0xf28a9d, emissive: teamColor, emissiveIntensity: .35, metalness: .8, roughness: .2 });
  if (structure.kind === "nexus") {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.4, 1.4, 8), baseMat); base.position.y = .7; base.castShadow = true; group.add(base);
    const crystal = createCrystal(teamColor, 1.9); crystal.position.y = 3.3; group.add(crystal);
  } else if (structure.kind === "inhibitor") {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.2, 1.1, 8), baseMat); base.position.y = .55; base.castShadow = true; group.add(base);
    const crystal = createCrystal(teamColor, 1.35); crystal.position.y = 2.5; group.add(crystal);
  } else {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(structure.kind === "nexusTower" ? 1.9 : 1.55, structure.kind === "nexusTower" ? 2.5 : 2.1, 1.1, 8), baseMat); base.position.y = .55; base.castShadow = true; group.add(base);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.48, .78, structure.kind === "nexusTower" ? 4.8 : 4, 6), metalMat); shaft.position.y = 2.8; shaft.castShadow = true; group.add(shaft);
    const cap = createCrystal(teamColor, structure.kind === "nexusTower" ? .8 : .63); cap.position.y = 5.35; group.add(cap);
  }
  group.position.set(structure.x, 0, structure.z); scene.add(group); structure.visual = group; return group;
}

function setupStructures() {
  const layouts = [
    [-92, -4, "outer", "外侧炮塔 I"], [-82, 4, "outer", "外侧炮塔 II"], [-70, 0, "inhibitor", "高地抑制器"], [-57, -4, "nexusTower", "门牙塔 I"], [-57, 4, "nexusTower", "门牙塔 II"], [-43, 0, "nexus", "核心枢纽"]
  ];
  for (const team of ["blue", "red"]) for (const [baseX, z, kind, name] of layouts) {
    const direction = team === "blue" ? 1 : -1;
    const structure = { kind, team, role: kind, name, x: team === "blue" ? baseX : -baseX, z, hp: kind === "nexus" ? 2600 : kind === "inhibitor" ? 1850 : kind === "nexusTower" ? 1350 : 1600, maxHp: kind === "nexus" ? 2600 : kind === "inhibitor" ? 1850 : kind === "nexusTower" ? 1350 : 1600, radius: kind === "nexus" ? 4.4 : 2.3, attackTimer: .8, visual: null, direction };
    structures.push(structure); createStructureVisual(structure);
  }
}
setupStructures();

function createUnitVisual(unit) {
  const group = new THREE.Group();
  const teamColor = colorFor(unit.team);
  if (unit.kind === "champion" || unit.kind === "player") {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(.78, 1.45, 5, 10), new THREE.MeshStandardMaterial({ color: unit.team === "blue" ? 0x217caf : (unit.role === "mage" ? 0x843fa7 : 0xa54257), emissive: teamColor, emissiveIntensity: .25, roughness: .42, metalness: .35 }));
    body.position.y = 1.3; body.castShadow = true; group.add(body);
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(.58, 1), new THREE.MeshStandardMaterial({ color: unit.team === "blue" ? 0xa7f5ff : 0xffb1c2, emissive: teamColor, emissiveIntensity: .35, roughness: .25, metalness: .2 }));
    head.position.y = 2.62; head.castShadow = true; group.add(head);
    const aura = new THREE.Mesh(new THREE.TorusGeometry(1.02, .055, 8, 32), new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: .78, blending: THREE.AdditiveBlending }));
    aura.rotation.x = Math.PI / 2; aura.position.y = .08; group.add(aura); group.userData.aura = aura;
    if (unit.role === "mage" || unit.kind === "player") { const orb = new THREE.Mesh(new THREE.SphereGeometry(.2, 12, 12), new THREE.MeshBasicMaterial({ color: 0xdafaff, blending: THREE.AdditiveBlending })); orb.position.set(.88, 1.35, .28); group.add(orb); }
  } else {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(unit.minionType === "caster" ? .36 : .55, unit.minionType === "caster" ? .52 : .68, unit.minionType === "caster" ? 1.15 : 1.25, unit.minionType === "caster" ? 5 : 6), new THREE.MeshStandardMaterial({ color: unit.team === "blue" ? (unit.minionType === "caster" ? 0x65bddd : 0x3c83b6) : (unit.minionType === "caster" ? 0xd15a85 : 0xb04467), emissive: teamColor, emissiveIntensity: .2, roughness: .6 }));
    body.position.y = .8; body.castShadow = true; group.add(body);
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(unit.minionType === "caster" ? .36 : .25, 0), new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: .9, blending: THREE.AdditiveBlending }));
    crystal.position.y = 1.65; group.add(crystal);
  }
  group.position.set(unit.x, 0, unit.z); group.userData.phase = Math.random() * Math.PI * 2; scene.add(group); unit.visual = group; return group;
}

function spawnWave() {
  for (const team of ["blue", "red"]) {
    const x = team === "blue" ? -106 : 106;
    [-2.3, 0, 2.3].forEach((z, index) => { const unit = { kind: "minion", minionType: "melee", team, x: x + (team === "blue" ? -index * 1.4 : index * 1.4), z, hp: 240, maxHp: 240, radius: .7, speed: 2.7, range: 2.3, damage: 25, attackTimer: index * .12, stun: 0, visual: null }; units.push(unit); createUnitVisual(unit); });
    const caster = { kind: "minion", minionType: "caster", team, x: x + (team === "blue" ? -4 : 4), z: 0, hp: 155, maxHp: 155, radius: .55, speed: 2.2, range: 12, damage: 19, attackTimer: .3, stun: 0, visual: null }; units.push(caster); createUnitVisual(caster);
  }
  addFeed("新一波兵线抵达。", "#a7dfff");
}

function spawnHorde() {
  const count = Math.min(12, 4 + Math.floor(elapsed / 18));
  for (let i = 0; i < count; i++) { const swarm = { kind: "minion", minionType: "swarm", team: "red", x: 105 + Math.random() * 5, z: -7 + Math.random() * 14, hp: 90 + elapsed * .5, maxHp: 90 + elapsed * .5, radius: .52, speed: 4.1 + Math.random() * .8, range: 1.7, damage: 12 + Math.floor(elapsed / 35), attackTimer: Math.random(), stun: 0, visual: null }; units.push(swarm); createUnitVisual(swarm); }
  if (count >= 8) addFeed(`海克斯潮群涌入：${count} 个敌方单位。`, "#ff9faf");
}

function nearestEnemy(source, range = Infinity, includeStructures = true) {
  let best = null; let bestDistance = range;
  const candidates = [];
  if (source.team === "red" && alive(player)) candidates.push(player);
  for (const unit of units) if (alive(unit) && enemyOf(source.team, unit)) candidates.push(unit);
  if (includeStructures) for (const structure of structures) if (alive(structure) && enemyOf(source.team, structure)) candidates.push(structure);
  for (const candidate of candidates) { const d = distance(source, candidate); if (d < bestDistance) { best = candidate; bestDistance = d; } }
  return best;
}

function createEffect(position, color, kind = "ring", radius = 3, life = .55) {
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .82, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  let mesh;
  if (kind === "nova") mesh = new THREE.Mesh(new THREE.SphereGeometry(.35, 20, 20), material);
  else if (kind === "beam") mesh = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, 5, 8), material);
  else mesh = new THREE.Mesh(new THREE.TorusGeometry(.7, .09, 8, 36), material);
  mesh.position.copy(position); mesh.position.y += kind === "beam" ? 2 : .12;
  if (kind !== "beam") mesh.rotation.x = Math.PI / 2;
  mesh.scale.setScalar(kind === "nova" ? .8 : .3); scene.add(mesh); effects.push({ mesh, kind, radius, life, max: life }); return mesh;
}

function spawnProjectile(from, target, damageAmount, team, type = "basic", speed = 24) {
  const material = new THREE.MeshBasicMaterial({ color: type === "tower" ? 0xffd18b : team === "blue" ? (type === "frost" ? 0xd7fbff : 0x75dfff) : 0xff718e, blending: THREE.AdditiveBlending });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(type === "tower" ? .28 : .18, 12, 12), material); mesh.position.set(from.x, 1.35, from.z); scene.add(mesh);
  createEffect(new THREE.Vector3(from.x, 1.35, from.z), material.color.getHex(), "nova", 1, .18);
  projectiles.push({ mesh, target, damage: damageAmount, team, type, speed, ttl: 3 });
}

function gainXp(amount) {
  player.xp += amount;
  while (player.xp >= player.nextXp && player.level < 10) { player.xp -= player.nextXp; player.nextXp = Math.round(player.nextXp * 1.22); player.level += 1; player.maxHp += 80; player.maxMana += 30; player.hp = player.maxHp; player.mana = player.maxMana; player.pendingUpgrades += 1; notify(`升级！现在是 Lv.${player.level}`); addFeed(`寒星升至 Lv.${player.level}，等待选择海克斯强化。`, "#ffd47f"); }
  if (!paused && player.pendingUpgrades > 0) showUpgrade();
}

function damage(target, amount, sourceTeam, label = "") {
  if (!target || !alive(target)) return;
  if (target === player) player.combatTimer = 0;
  let finalAmount = amount;
  if (target === player && player.shield > 0) { const absorbed = Math.min(player.shield, finalAmount); player.shield -= absorbed; finalAmount -= absorbed; }
  if (sourceTeam === "blue") { finalAmount *= player.build.allDamageMult; if (player.hp / player.maxHp < .4) finalAmount *= 1 + player.build.lowHealthBonus; if (target.kind === "tower" || target.kind === "inhibitor" || target.kind === "nexusTower" || target.kind === "nexus") finalAmount *= player.build.structureDamage; }
  target.hp = Math.max(0, target.hp - finalAmount);
  if (label) addText(label, new THREE.Vector3(target.x, target.kind === "minion" ? 1.8 : 3.8, target.z), sourceTeam === "blue" ? "#c5f7ff" : "#ffb4c3");
  createEffect(new THREE.Vector3(target.x, .35, target.z), sourceTeam === "blue" ? 0x9defff : 0xff6f8c, "nova", .6, .2);
  if (target.hp <= 0) killEntity(target, sourceTeam);
}

function killEntity(target, sourceTeam) {
  if (!target || target.hp > 0) return;
  if (target.kind === "player") { redKills++; player.respawn = 8; player.visual.visible = false; addFeed("寒星倒下了，8 秒后从蓝方复活点重返战场。", "#ff9faf"); requestShop("死亡后可前往复活点商店"); }
  else if (target.kind === "champion") { target.respawn = 8; target.visual.visible = false; if (sourceTeam === "blue") { blueKills++; player.gold += 220; gainXp(220); if (player.build.hpOnKill) player.hp = Math.min(player.maxHp, player.hp + player.build.hpOnKill); addFeed(`${target.name} 被击败，8 秒后从红方复活点返回。`, "#a2ffe2"); } }
  else if (target.kind === "minion") { target.visual.visible = false; if (sourceTeam === "blue") { player.gold += target.minionType === "swarm" ? 18 : 40; gainXp(target.minionType === "caster" ? 42 : 32); if (player.build.hpOnKill) player.hp = Math.min(player.maxHp, player.hp + player.build.hpOnKill); } }
  else if (target.kind === "nexus") { gameOver = true; victory = target.team === "red"; target.visual.visible = false; document.getElementById("matchState").textContent = victory ? "胜利" : "失败"; document.getElementById("objectiveText").textContent = victory ? "敌方核心枢纽已崩解" : "我方核心枢纽被摧毁"; notify(victory ? "胜利 · 极地裂隙" : "失败 · 再来一局"); }
  else { target.visual.visible = false; if (sourceTeam === "blue") player.gold += target.kind === "inhibitor" ? 360 : target.kind === "nexusTower" ? 300 : 260; addFeed(`${target.name} 被摧毁。`, target.team === "red" ? "#a2ffe2" : "#ff9faf"); notify(target.team === "red" ? `${target.name} 已摧毁` : `${target.name} 失守`); }
}

function castAbility(key) {
  if (gameOver || paused || player.respawn > 0 || player.stun > 0 || player.cds[key] > 0) return;
  const costs = { q: 40, w: 65, e: 55, r: 100 };
  if (player.mana < costs[key]) { notify("法力不足"); return; }
  player.mana -= costs[key];
  const skillScale = key === "q" ? 1 : key === "e" ? player.build.eDamageMult : key === "r" ? player.build.rDamageMult : 1;
  if (key === "q") {
    const target = nearestEnemy(player, 30);
    if (!target) { player.mana += costs[key]; notify("射程内没有目标"); return; }
    spawnProjectile(player, target, (88 + player.level * 20) * player.build.qDamageMult, "blue", "frost", 28); player.cds.q = 2.3;
    if (player.build.qBounce) { const second = units.find(unit => alive(unit) && enemyOf("blue", unit) && unit !== target && distance(target, unit) < 7); if (second) setTimeout(() => spawnProjectile(target, second, 48 + player.level * 8, "blue", "frost", 25), 120); }
  } else if (key === "w") {
    const dx = pointerWorld.x - player.x, dz = pointerWorld.z - player.z; const len = Math.hypot(dx, dz) || 1; const jump = Math.min(19, Math.max(7, len));
    player.x = clamp(player.x + dx / len * jump, world.minX + 2, world.maxX - 2); player.z = clamp(player.z + dz / len * jump, -7, 7); player.shield = 165 + player.level * 22 + player.build.wShieldBonus; player.cds.w = 8 * player.build.wCooldownMult; createEffect(new THREE.Vector3(player.x, .2, player.z), 0xa5f2ff, "ring", 5, .5);
  } else if (key === "e") {
    const radius = 8 + player.build.eRadius; createEffect(new THREE.Vector3(player.x, .2, player.z), 0x9fe8ff, "ring", radius, .48);
    for (const target of [...units, ...structures]) if (alive(target) && enemyOf("blue", target) && distance(player, target) < radius) { damage(target, (72 + player.level * 13) * skillScale, "blue", "裂冰"); target.stun = player.build.eFreeze ? 1.7 : .8; }
    player.cds.e = 6.5;
  } else if (key === "r") {
    const radius = 7 + player.build.rRadius; createEffect(new THREE.Vector3(pointerWorld.x, .2, pointerWorld.z), 0xffd37b, "nova", radius, .85); createEffect(new THREE.Vector3(pointerWorld.x, .2, pointerWorld.z), 0xffe9a8, "ring", radius, .85);
    for (const target of [...units, ...structures]) if (alive(target) && enemyOf("blue", target) && Math.hypot(target.x - pointerWorld.x, target.z - pointerWorld.z) < radius) damage(target, (245 + player.level * 35) * skillScale, "blue", "星落");
    player.cds.r = 18;
  }
}

function updatePlayer(dt) {
  if (player.respawn > 0) { player.respawn -= dt; if (player.respawn <= 0) { player.hp = player.maxHp; player.mana = player.maxMana; player.x = spawnPoints.blue.x; player.z = spawnPoints.blue.z; player.visual.visible = true; addFeed("寒星从蓝方复活点重返战场。", "#a7dfff"); } return; }
  player.cds.q = Math.max(0, player.cds.q - dt * (1 + player.build.manaRegen * .004)); player.cds.w = Math.max(0, player.cds.w - dt * (1 + player.build.manaRegen * .004)); player.cds.e = Math.max(0, player.cds.e - dt * (1 + player.build.manaRegen * .004)); player.cds.r = Math.max(0, player.cds.r - dt * (1 + player.build.manaRegen * .004)); player.shield = Math.max(0, player.shield - dt * 50); player.stun = Math.max(0, player.stun - dt); player.mana = Math.min(player.maxMana, player.mana + dt * player.build.manaRegen);
  if (player.stun > 0) return;
  let dx = 0, dz = 0; if (keys.has("arrowleft")) dx -= 1; if (keys.has("arrowright")) dx += 1; if (keys.has("arrowup")) dz -= 1; if (keys.has("arrowdown")) dz += 1;
  if (!dx && !dz && moveTarget) { dx = moveTarget.x - player.x; dz = moveTarget.z - player.z; if (Math.hypot(dx, dz) < .7) moveTarget = null; }
  const length = Math.hypot(dx, dz) || 1; if (dx || dz) { player.x = clamp(player.x + dx / length * player.speed * dt, world.minX + 2, world.maxX - 2); player.z = clamp(player.z + dz / length * player.speed * dt, -7, 7); }
  player.attackTimer -= dt; if (player.attackTimer <= 0) { const target = nearestEnemy(player, 31); if (target) { spawnProjectile(player, target, 40 + player.level * 8 + player.build.autoDamage, "blue", "basic", 23); player.attackTimer = .72; } }
  if (relic.active && distance(player, relic) < 4) { relic.active = false; relicTimer = 13; player.hp = Math.min(player.maxHp, player.hp + 300 * player.build.relicPower); player.mana = Math.min(player.maxMana, player.mana + 160 * player.build.relicPower); notify("治疗圣坛已吸收"); addFeed("寒星获得治疗圣坛的祝福。", "#ffd47f"); }
}

function updateMinion(unit, dt) {
  if (unit.stun > 0) { unit.stun -= dt; return; } unit.attackTimer -= dt; const target = nearestEnemy(unit, unit.range + 3); const d = target ? distance(unit, target) : Infinity;
  if (target && d <= unit.range + target.radius) { if (unit.attackTimer <= 0) { damage(target, unit.damage, unit.team, `${unit.damage}`); unit.attackTimer = unit.minionType === "caster" ? 1.35 : 1.05; } }
  else { const dir = unit.team === "blue" ? 1 : -1; unit.x += dir * unit.speed * dt; unit.z += (0 - unit.z) * dt * 1.7; }
}

function updateChampion(unit, dt) {
  if (unit.respawn > 0) { unit.respawn -= dt; if (unit.respawn <= 0) { unit.hp = unit.maxHp; unit.x = spawnPoints.red.x + (Math.random() - .5) * 3; unit.z = (Math.random() - .5) * 5; unit.visual.visible = true; addFeed(`${unit.name} 从红方复活点返回战场。`, "#ffb3c3"); } return; }
  if (unit.stun > 0) { unit.stun -= dt; return; } unit.attackTimer -= dt; const target = nearestEnemy(unit, 70, false) || nearestEnemy(unit, 70, true); if (!target) return; const d = distance(unit, target);
  if (d <= unit.range + target.radius) { if (unit.attackTimer <= 0) { if (unit.role === "mage") spawnProjectile(unit, target, unit.damage, "red", "ember", 16); else damage(target, unit.damage, "red", `${unit.damage}`); unit.attackTimer = unit.role === "mage" ? 1.45 : 1.05; } }
  else { const dx = target.x - unit.x, dz = target.z - unit.z, len = Math.hypot(dx, dz) || 1; unit.x += dx / len * unit.speed * dt; unit.z += dz / len * unit.speed * dt; }
}

function updateTower(structure, dt) { if (structure.hp <= 0) return; structure.attackTimer -= dt; if (structure.attackTimer <= 0) { const target = nearestEnemy(structure, 30, false); if (target) { spawnProjectile(structure, target, 85, structure.team, "tower", 19); structure.attackTimer = 1.15; } } }

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) { const projectile = projectiles[i]; projectile.ttl -= dt; const target = projectile.target; if (!alive(target)) { scene.remove(projectile.mesh); projectiles.splice(i, 1); continue; } const targetPosition = new THREE.Vector3(target.x, target.kind === "nexus" ? 3 : target.kind === "minion" ? 1 : 2, target.z); const direction = targetPosition.clone().sub(projectile.mesh.position); const step = projectile.speed * dt; if (direction.length() <= step + (target.radius || 1)) { damage(target, projectile.damage, projectile.team, projectile.type === "frost" ? "霜矢" : projectile.type === "tower" ? "炮击" : ""); scene.remove(projectile.mesh); projectiles.splice(i, 1); } else { projectile.mesh.position.add(direction.normalize().multiplyScalar(step)); projectile.mesh.rotation.y += dt * 7; } if (projectile.ttl <= 0) { scene.remove(projectile.mesh); projectiles.splice(i, 1); } }
}

function updateVisuals(dt) {
  for (const unit of units) if (unit.visual) { if (!alive(unit)) { if (unit.kind !== "champion" || unit.respawn > 0) unit.visual.visible = false; continue; } unit.visual.visible = true; unit.visual.position.set(unit.x, Math.sin(elapsed * 3 + unit.visual.userData.phase) * .05, unit.z); unit.visual.rotation.y += dt * (unit.kind === "minion" ? 1.5 : .6); if (unit.visual.userData.aura) unit.visual.userData.aura.scale.setScalar(1 + Math.sin(elapsed * 4) * .08); }
  if (player.visual) { player.visual.visible = player.respawn <= 0; player.visual.position.set(player.x, Math.sin(elapsed * 3 + player.visual.userData.phase) * .05, player.z); if (player.visual.userData.aura) player.visual.userData.aura.scale.setScalar(1 + Math.sin(elapsed * 4) * .08); }
  for (const structure of structures) if (structure.visual) { if (structure.hp <= 0) structure.visual.visible = false; else { structure.visual.visible = true; structure.visual.position.y = Math.sin(elapsed * 1.6 + structure.x) * .04; structure.visual.rotation.y += dt * .12; } }
  for (const effect of effects) { effect.life -= dt; const progress = 1 - effect.life / effect.max; effect.mesh.scale.setScalar(effect.kind === "nova" ? .8 + progress * effect.radius : .4 + progress * effect.radius * .24); effect.mesh.material.opacity = Math.max(0, effect.life / effect.max) * .82; if (effect.life <= 0) { scene.remove(effect.mesh); effects.splice(effects.indexOf(effect), 1); } }
  for (const floater of floaters) { floater.life -= dt; floater.position.y += dt * 2; if (floater.life <= 0) floaters.splice(floaters.indexOf(floater), 1); }
}

function updateCamera(dt) { const target = new THREE.Vector3(player.x + 2, 0, player.z); const desired = new THREE.Vector3(player.x - 24, 29, 30); camera.position.lerp(desired, Math.min(1, dt * 4)); camera.lookAt(target); }

function showUpgrade() {
  if (gameOver || player.pendingUpgrades <= 0) return; paused = true; const modal = document.getElementById("upgradeModal"); const choices = document.getElementById("upgradeChoices"); choices.innerHTML = "";
  const available = augmentPool.filter(item => !player.augments.includes(item.id)); const selected = [];
  while (selected.length < 3 && available.length) { const index = Math.floor(Math.random() * available.length); selected.push(available.splice(index, 1)[0]); }
  for (const augment of selected) { const card = document.createElement("div"); card.className = "upgrade-choice"; card.innerHTML = `<div class="rarity ${augment.rarity}">${augment.rarity === "prismatic" ? "棱彩强化" : augment.rarity === "gold" ? "黄金强化" : "白银强化"}</div><h3>${augment.name}</h3><p>${augment.desc}</p><button>选择强化</button>`; card.addEventListener("click", () => applyAugment(augment)); choices.appendChild(card); }
  modal.classList.remove("hidden");
}

function applyAugment(augment) { augment.apply(); player.augments.push(augment.id); player.pendingUpgrades = Math.max(0, player.pendingUpgrades - 1); addFeed(`获得海克斯强化：${augment.name}`, "#e1c2ff"); notify(`海克斯强化 · ${augment.name}`); document.getElementById("upgradeModal").classList.add("hidden"); updateBuildSummary(); if (player.pendingUpgrades > 0) showUpgrade(); else { paused = false; requestShop("升级后可前往复活点商店"); } }
function updateBuildSummary() { document.getElementById("buildSummary").innerHTML = player.augments.length ? player.augments.map(id => { const item = augmentPool.find(a => a.id === id); return `<span class="build-chip">${item.name}</span>`; }).join("") : "尚未选择强化"; }
function shopCanOpen() { return player.respawn > 0 || distance(player, spawnPoints.blue) < 8; }
function requestShop(reason) { player.shopPending = true; player.shopReason = reason; if (!paused && player.combatTimer >= 5 && shopCanOpen()) openShop(reason); else addFeed("商店暂不可用：需要在复活点附近脱战 5 秒。", "#ffd47f"); }
function renderShop() { const container = document.getElementById("shopItems"); document.getElementById("shopGold").textContent = `${player.gold} 金币`; container.innerHTML = shopItems.map(item => `<div class="shop-item"><h3>${item.name}</h3><div class="cost">${item.cost} 金币</div><p>${item.desc}</p><button data-shop-item="${item.id}" ${player.gold < item.cost ? "disabled" : ""}>购买</button></div>`).join(""); container.querySelectorAll("[data-shop-item]").forEach(button => button.addEventListener("click", () => buyShopItem(button.dataset.shopItem))); }
function openShop(reason) { if (gameOver || player.combatTimer < 5 || !shopCanOpen()) return; player.shopPending = false; paused = true; document.getElementById("shopReason").innerHTML = `${reason} · 已脱战 ${Math.floor(player.combatTimer)} 秒 · <b id="shopGold">${player.gold} 金币</b>`; document.getElementById("shopModal").classList.remove("hidden"); renderShop(); }
function buyShopItem(id) { const item = shopItems.find(entry => entry.id === id); if (!item || player.gold < item.cost) { notify("金币不足"); return; } player.gold -= item.cost; item.buy(); player.items.push(item.id); addFeed(`购买装备：${item.name}`, "#ffd47f"); notify(`已购买 · ${item.name}`); renderShop(); updateHud(); }
function closeShop() { document.getElementById("shopModal").classList.add("hidden"); paused = false; }
function updateItemSummary() { document.getElementById("itemSummary").innerHTML = player.items.length ? player.items.map(id => { const item = shopItems.find(entry => entry.id === id); return `<span class="build-chip">${item.name}</span>`; }).join("") : "尚未购买装备"; }

function chooseChampion(champion) {
  player.championId = champion.id; player.role = champion.roleId; player.name = champion.name; player.abilityNames = champion.skills; player.maxHp = champion.hp; player.maxMana = champion.mana; player.hp = champion.hp; player.mana = champion.mana; player.speed = champion.speed;
  document.getElementById("championName").textContent = champion.name; document.getElementById("championPortrait").src = `${championAssetRoot}${champion.id}.png`; ["q", "w", "e", "r"].forEach((key, index) => { document.getElementById(`${key}Name`).textContent = champion.skills[index]; });
  if (player.visual) scene.remove(player.visual); player.visual = createUnitVisual(player); player.visual.visible = true;
  document.getElementById("championModal").style.display = "none"; document.getElementById("matchState").textContent = `${champion.name} · 战斗进行中`; paused = false; notify(`${champion.name} 加入极地裂隙`);
}

function setupChampionSelect() {
  const choices = document.getElementById("championChoices"); choices.innerHTML = "";
  for (const champion of championPool) { const card = document.createElement("button"); card.className = "champion-card"; card.innerHTML = `<img src="${championAssetRoot}${champion.id}.png" alt="${champion.name}"><div class="champion-copy"><h3>${champion.name}</h3><div class="champion-role">${champion.role} · ${champion.hp} 生命</div><p>${champion.description}</p></div>`; card.addEventListener("click", () => chooseChampion(champion)); choices.appendChild(card); }
}

const relic = { x: 0, z: 4.5, active: true, visual: null };
relic.visual = new THREE.Group(); const relicBase = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.5, .35, 8), new THREE.MeshStandardMaterial({ color: 0x8b6631, emissive: 0xffc65d, emissiveIntensity: .45, metalness: .65 })); relicBase.position.y = .2; relic.visual.add(relicBase); const relicCrystal = createCrystal(0xffd06e, .75); relicCrystal.position.y = 1.3; relic.visual.add(relicCrystal); relic.visual.position.set(relic.x, 0, relic.z); scene.add(relic.visual);

player.visual = createUnitVisual(player);
const champions = [{ kind: "champion", team: "red", name: "赤焰守卫", role: "tank", x: 84, z: -3.2, hp: 980, maxHp: 980, radius: 1.2, speed: 4.7, range: 13, damage: 34, attackTimer: 1, respawn: 0, stun: 0, visual: null }, { kind: "champion", team: "red", name: "暮光术士", role: "mage", x: 91, z: 3.3, hp: 620, maxHp: 620, radius: 1, speed: 5.6, range: 25, damage: 52, attackTimer: 1.2, respawn: 0, stun: 0, visual: null }];
champions.forEach(champion => { units.push(champion); createUnitVisual(champion); });
spawnWave();

function updateHud() {
  document.getElementById("blueScore").textContent = `${blueKills} 击杀`; document.getElementById("redScore").textContent = `${redKills} 击杀`; document.getElementById("levelText").textContent = `Lv.${player.level}`; document.getElementById("hpFill").style.width = `${clamp(player.hp / player.maxHp, 0, 1) * 100}%`; document.getElementById("manaFill").style.width = `${clamp(player.mana / player.maxMana, 0, 1) * 100}%`; document.getElementById("hpText").textContent = `${Math.ceil(player.hp)} / ${player.maxHp}`; document.getElementById("manaText").textContent = `${Math.ceil(player.mana)} / ${player.maxMana}`;
  for (const key of ["q", "w", "e", "r"]) { const card = document.querySelector(`[data-key="${key}"]`); card.classList.toggle("cooldown", player.cds[key] > 0); document.getElementById(`${key}Cd`).textContent = player.cds[key] > 0 ? player.cds[key].toFixed(1) : ""; }
  const blueNexus = structures.find(s => s.team === "blue" && s.kind === "nexus"); const redNexus = structures.find(s => s.team === "red" && s.kind === "nexus"); document.getElementById("blueNexusFill").style.width = `${blueNexus.hp / blueNexus.maxHp * 100}%`; document.getElementById("redNexusFill").style.width = `${redNexus.hp / redNexus.maxHp * 100}%`; document.getElementById("blueNexusText").textContent = Math.ceil(blueNexus.hp); document.getElementById("redNexusText").textContent = Math.ceil(redNexus.hp); document.getElementById("relicState").textContent = relic.active ? "中央治疗圣坛：可拾取" : `中央治疗圣坛：${Math.ceil(relicTimer)} 秒后重生`; document.getElementById("goldText").textContent = `${player.gold} 金币`; updateItemSummary(); document.getElementById("feed").innerHTML = feed.map(item => typeof item === "string" ? `<p>${item}</p>` : `<p style="color:${item.color}">${item.text}</p>`).join("");
}

function update(dt) {
  if (!paused && !gameOver) { elapsed += dt; player.combatTimer += dt; waveTimer -= dt; hordeTimer -= dt; if (waveTimer <= 0) { spawnWave(); waveTimer = 9; } if (hordeTimer <= 0) { spawnHorde(); hordeTimer = Math.max(2.8, 6.2 - elapsed * .018); } if (!relic.active) { relicTimer -= dt; if (relicTimer <= 0) { relic.active = true; relic.visual.visible = true; addFeed("中央治疗圣坛重新激活。", "#ffd47f"); } } updatePlayer(dt); for (const unit of units) { if (unit.kind === "minion") updateMinion(unit, dt); else if (unit.kind === "champion") updateChampion(unit, dt); } for (const structure of structures) if (structure.kind !== "nexus") updateTower(structure, dt); updateProjectiles(dt); if (player.shopPending && player.combatTimer >= 5 && shopCanOpen()) openShop(player.shopReason); }
  if (relic.active) { relic.visual.visible = true; relic.visual.rotation.y += dt * 1.2; relic.visual.position.y = Math.sin(elapsed * 2) * .08; } else relic.visual.visible = false;
  for (const point of Object.values(spawnPoints)) if (point.visual) { point.visual.userData.ring.rotation.z += dt * (point === spawnPoints.blue ? 1 : -1); point.visual.userData.ring.material.opacity = .62 + Math.sin(elapsed * 2.4) * .2; }
  updateVisuals(dt); updateCamera(dt); if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) document.getElementById("toast").classList.remove("show"); } updateHud();
}

function render() { renderer.render(scene, camera); }
function resize() { const width = canvas.clientWidth || 1280; const height = canvas.clientHeight || 720; const aspect = width / height; const viewHeight = 24; camera.left = -viewHeight * aspect / 2; camera.right = viewHeight * aspect / 2; camera.top = viewHeight / 2; camera.bottom = -viewHeight / 2; renderer.setSize(width, height, false); camera.updateProjectionMatrix(); }
function updatePointer(event, setTarget = false) { const rect = canvas.getBoundingClientRect(); pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1; pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1; raycaster.setFromCamera(pointer, camera); const hit = new THREE.Vector3(); if (raycaster.ray.intersectPlane(movePlane, hit)) { pointerWorld.copy(hit); pointerWorld.x = clamp(pointerWorld.x, world.minX + 2, world.maxX - 2); pointerWorld.z = clamp(pointerWorld.z, -7, 7); if (setTarget) { moveTarget = { x: pointerWorld.x, z: pointerWorld.z }; createEffect(new THREE.Vector3(pointerWorld.x, .1, pointerWorld.z), 0x9bdfff, "ring", 1.6, .25); } } }

window.addEventListener("resize", resize);
window.addEventListener("keydown", event => { const key = event.key.toLowerCase(); if (["q", "w", "e", "r"].includes(key)) { event.preventDefault(); castAbility(key); } else keys.add(key); });
window.addEventListener("keyup", event => keys.delete(event.key.toLowerCase()));
canvas.addEventListener("pointermove", event => updatePointer(event)); canvas.addEventListener("pointerdown", event => updatePointer(event, true));
document.querySelectorAll(".ability").forEach(card => card.addEventListener("click", () => castAbility(card.dataset.key)));
document.getElementById("restartBtn").addEventListener("click", () => window.location.reload());
document.getElementById("closeShop").addEventListener("click", closeShop);
document.getElementById("championPortrait").addEventListener("error", event => { event.currentTarget.style.display = "none"; });

resize(); updateBuildSummary(); updateItemSummary(); updateHud(); setupChampionSelect(); paused = true;
let previous = performance.now();
function frame(now) { const dt = Math.min(.04, (now - previous) / 1000); previous = now; update(dt); render(); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
