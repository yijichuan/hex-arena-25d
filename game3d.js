import * as THREE from "./vendor-three.module.min.js";
import { GLTFLoader } from "./GLTFLoader.js";
import { clone as cloneSkeleton } from "./SkeletonUtils.js";
import { buildAbyssEnvironment } from "./world3d.js";

const championAssetRoot = "./assets/champion/";
const spellAssetRoot = "./assets/spell/";
const effectAssetRoot = "./assets/effects/";

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
const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin("anonymous");
const snowflakeFxTexture = textureLoader.load(`${effectAssetRoot}snowflake1.png`);
const sparkFxTexture = textureLoader.load(`${effectAssetRoot}spark1.png`);
const championModelLoader = new GLTFLoader();
const unitModelCache = new Map();
const worldActors = [];
const shopActors = {};
const keys = new Set();
const units = [];
const structures = [];
const projectiles = [];
const effects = [];
const floaters = [];
const feed = ["3D 极地裂隙已加载。", "清理兵线并推进到敌方核心枢纽。"];
const world = { minX: -116, maxX: 116, halfWidth: 10 };
const sceneScale = { hero: .75, minion: .85, building: 1.15 };
const spawnPoints = { blue: { x: -110, z: 0, visual: null }, red: { x: 110, z: 0, visual: null } };
let elapsed = 0;
const waveInterval = 9;
let waveTimer = waveInterval;
let waveNumber = 0;
let relicTimer = 0;
let toastTimer = 0;
let blueKills = 0;
let redKills = 0;
let gameOver = false;
let victory = false;
let paused = false;
let moveTarget = null;
const superMinionReady = { blue: false, red: false };
let screenShake = 0;
let damageFlash = 0;

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
keyLight.shadow.camera.left = -130; keyLight.shadow.camera.right = 130; keyLight.shadow.camera.top = 40; keyLight.shadow.camera.bottom = -40; keyLight.shadow.camera.far = 180;

function visibleModelBounds(model) {
  model.updateWorldMatrix(true, true);
  // SkinnedMesh.updateMatrixWorld refreshes its attached bind inverse; the
  // similarly named updateWorldMatrix method does not do that in Three r161.
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3(), vertex = new THREE.Vector3();
  // Exported primitives share a position buffer. Only their indexed vertices
  // belong to that part; hidden debris must not affect the model's size.
  model.traverseVisible(node => {
    if (!node.isMesh) return;
    const indices = node.geometry.index;
    const vertices = indices ? new Set(indices.array) : Array.from({ length: node.geometry.attributes.position.count }, (_, i) => i);
    for (const index of vertices) { node.getVertexPosition(index, vertex); bounds.expandByPoint(vertex.applyMatrix4(node.matrixWorld)); }
  });
  return bounds;
}

function applyModelMeshState(actor, state, settled = false) {
  const data = actor.visual.userData;
  const isTurret = /^turret-/.test(data.modelFile || '');
  const isCrystal = /^(inhibitor|nexus)-/.test(data.modelFile || '');
  data.modelRoot.traverse(node => {
    if (!node.isMesh) return;
    const name = node.material.name;
    if (isTurret) {
      node.visible = state === 'death' ? name === 'Rubble' || (!settled && /^Broken[123]$/.test(name))
        : name === (state === 'damaged3' ? 'Stage3' : state === 'damaged2' ? 'Stage2' : 'Base');
    } else if (isCrystal && state === 'death' && settled) node.visible = name === 'Destroyed';
    else node.visible = node.material.userData.visible !== false;
  });
}

function loadWorldModel(actor, filename, options = {}) {
  const wrapper = actor.visual, url = `./models/world/${filename}`;
  if (!unitModelCache.has(url)) unitModelCache.set(url, championModelLoader.loadAsync(url));
  unitModelCache.get(url).then(gltf => {
    if (actor.visual !== wrapper) return;
    const model = cloneSkeleton(gltf.scene), mixer = new THREE.AnimationMixer(model);
    const find = patterns => { for (const regex of patterns) { const clip = gltf.animations.find(c => regex.test(c.name)); if (clip) return clip; } return null; };
    const idle = find(options.idle ? [options.idle] : [/^idle1?(_base)?$/i, /^idle_normal1$/i, /idle/i, /^opened$/i, /^closed$/i]);
    if (idle) { mixer.clipAction(idle).play(); mixer.update(.01); }
    const data = wrapper.userData;
    data.modelRoot = model; data.modelFile = filename;
    applyModelMeshState(actor, 'idle');
    const bounds = visibleModelBounds(model), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    const extent = options.axis === 'xz' ? Math.max(size.x, size.z) : options.axis ? size[options.axis] : Math.max(size.x,size.y,size.z);
    const scale = (options.size || 5) / Math.max(.0000001, extent);
    model.position.x -= center.x; model.position.z -= center.z;
    if (options.anchor === 'top') model.position.y -= bounds.max.y;
    else if (options.anchor !== 'origin') model.position.y -= bounds.min.y;
    const pivot = new THREE.Group(); pivot.add(model); pivot.scale.setScalar(scale); pivot.rotation.y = options.rotation || 0;
    wrapper.add(pivot);
    model.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; node.frustumCulled = false; } });
    data.modelRoot = model; data.modelMixer = mixer; data.modelFile = filename;
    data.modelActions = { idle, attack: find([/^attack/i]), death: find([/^death/i, /^destroyed$/i, /^break/i]), damaged2: find([/^state2$/i]), damaged3: find([/^state3$/i]), open: find([/^open$/i, /entering/i]), close: find([/^close$/i, /leaving/i]), opened: find([/^opened$/i]), closed: find([/^closed$/i]) };
    for (const part of data.proceduralParts || []) part.visible = false;
    if (data.healthBar) data.healthBar.bar.position.y = bounds.max.y * scale + .7;
    playModelAnimation(actor, actor.action?.type || 'idle', actor.action?.duration);
    if (!alive(actor) && !(actor.deathRemaining > 0) && data.modelActions.death) {
      mixer.update((actor.action?.duration || data.modelActions.death.duration) + .2);
      applyModelMeshState(actor, 'death', true); data.deathSettled = true;
    }
    if (options.animate === false) { mixer.update(.01); data.staticModel = true; }
  }).catch(error => { console.warn(`World model failed: ${filename}`, error.message); });
}

function createWorldActor(filename, position, options = {}) {
  const visual = new THREE.Group(); visual.position.set(position.x, position.y || 0, position.z); scene.add(visual);
  const actor = { kind: 'scenery', hp: 1, maxHp: 1, visual, isMoving: false };
  worldActors.push(actor); loadWorldModel(actor, filename, options); return actor;
}

function addWorld() { buildAbyssEnvironment(scene, makeTexture, createWorldActor); }
addWorld();

const player = {
  kind: "player", team: "blue", championId: "Ashe", role: "ranged", name: "寒冰射手", abilityNames: ["射手专注", "万箭齐发", "鹰击长空", "水晶箭"], x: spawnPoints.blue.x, z: 0, radius: 1, hp: 680, maxHp: 680, mana: 360, maxMana: 360,
  level: 1, xp: 0, nextXp: 500, speed: 15, attackTimer: 0, respawn: 0, shield: 0, stun: 0, pendingUpgrades: 0, upgradeOptions: null, gold: 800, items: [], combatTimer: 0, shopPending: false, shopReason: "", nexusGateNotice: 0,
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

const championSpellIcons = {
  MasterYi: ["AlphaStrike", "Meditate", "WujuStyle", "Highlander"],
  Ashe: ["AsheQ", "Volley", "Hawkshot", "EnchantedCrystalArrow"],
  Garen: ["DecisiveStrike", "Courage", "Judgment", "GarenR"],
  Lux: ["LightBinding", "PrismaticBarrier", "LucentSingularity", "FinalSpark"],
  Ezreal: ["MysticShot", "EssenceFlux", "ArcaneShift", "TrueshotBarrage"],
  Blitzcrank: ["RocketGrab", "Overdrive", "PowerFist", "StaticField"],
  Jinx: ["JinxQ", "JinxW", "JinxE", "JinxR"],
  Morgana: ["DarkBinding", "BlackShield", "TormentedShadow", "SoulShackles"]
};

const heroProfiles = {
  MasterYi: { mode: "melee", accent: 0xffd66f, modelScale: 4.55, attackRange: 4.2, autoType: "blade", effects: [0xf4d36d, 0x9affc5, 0xffdf75, 0xffffff] },
  Ashe: { mode: "ranged", accent: 0x9feeff, modelScale: 4.35, attackRange: 31, autoType: "arrow", effects: [0xa9efff, 0x9feeff, 0x82dcff, 0xffd47f] },
  Garen: { mode: "melee", accent: 0x76b8ff, modelScale: 4.55, attackRange: 4.3, autoType: "blade", effects: [0x72b7ff, 0x9cd2ff, 0x73a8ff, 0xffe29b] },
  Lux: { mode: "mage", accent: 0xffe795, modelScale: 4.4, attackRange: 28, autoType: "orb", effects: [0xfff0a0, 0xd7b8ff, 0xffdc73, 0xffffff] },
  Ezreal: { mode: "ranged", accent: 0x70d9ff, modelScale: 4.3, attackRange: 30, autoType: "arcane", effects: [0x74dcff, 0x6ed6ff, 0xffd36d, 0xffc77a] },
  Blitzcrank: { mode: "melee", accent: 0xf5bf63, modelScale: 4.6, attackRange: 4.6, autoType: "fist", effects: [0xffc766, 0x8fdfff, 0xffc04d, 0xffe7a1] },
  Jinx: { mode: "ranged", accent: 0xff78c7, modelScale: 4.4, attackRange: 29, autoType: "bullet", effects: [0xff84ca, 0xff8c9e, 0xffb25d, 0xff6e9a] },
  Morgana: { mode: "mage", accent: 0x9d78ff, modelScale: 4.35, attackRange: 27, autoType: "shadow", effects: [0xb87bff, 0x8b73ff, 0xc36bff, 0xe3b8ff] }
};

function profileFor(unit) { return heroProfiles[unit?.championId] || heroProfiles.Ashe; }

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
function addText(text, position, color = "#baf3ff") {
  const image = document.createElement("canvas"); image.width = 256; image.height = 64; const context = image.getContext("2d"); context.font = "700 30px Segoe UI, Microsoft YaHei, sans-serif"; context.textAlign = "center"; context.lineWidth = 8; context.strokeStyle = "rgba(3,10,20,.9)"; context.strokeText(text, 128, 42); context.fillStyle = color; context.fillText(text, 128, 42);
  const texture = new THREE.CanvasTexture(image); texture.colorSpace = THREE.SRGBColorSpace; const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false })); sprite.position.copy(position); sprite.scale.set(3.2, .8, 1); sprite.renderOrder = 30; scene.add(sprite); floaters.push({ text, position: position.clone(), sprite, life: .85, max: .85, color });
}

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
  const sign = team === 'blue' ? -1 : 1;
  const shop = createWorldActor(team === 'blue' ? 'ha_ap_shpsouth.glb' : 'ha_ap_shpnorth.glb', {x:point.x,y:0,z:-9}, {size:6,axis:'xz',idle:/^closed$/i});
  const keeper = createWorldActor(team === 'blue' ? 'ha_ap_hermit.glb' : 'ha_ap_viking.glb', {x:point.x,y:0,z:-6.4}, {size:2.5,axis:'y'});
  createWorldActor(`brawl_fountainturret-${team === 'blue' ? 0 : 1}.glb`, {x:point.x+sign*3.5,y:0,z:5.2}, {size:2.8*sceneScale.building,axis:'xz',anchor:'origin',rotation:-sign*Math.PI/2});
  point.shop = shop.visual; shopActors[team] = {shop,keeper};
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
  group.userData.proceduralParts = [...group.children];
  for (const part of group.children) { part.scale.multiplyScalar(sceneScale.building); part.position.multiplyScalar(sceneScale.building); }
  group.position.set(structure.x, 0, structure.z); createHealthBarVisual(structure, group); scene.add(group); structure.visual = group;
  const asset = structure.kind === 'nexus' ? 'nexus' : structure.kind === 'inhibitor' ? 'inhibitor' : 'turret';
  loadWorldModel(structure, `${asset}-${structure.team === 'blue' ? 0 : 1}.glb`, { size: (structure.kind === 'nexus' ? 8.3 : structure.kind === 'inhibitor' ? 5.8 : 4.1) * sceneScale.building, axis: 'xz', anchor: 'origin', rotation: structure.team === 'blue' ? Math.PI / 2 : -Math.PI / 2 });
  return group;
}

function setupStructures() {
  // Ordered from the middle of the lane toward each team's rear base.
  // The two nexus towers share one stage; both must fall before the nexus.
  const layouts = [
    [-32, 0, "outer", "防御塔 I", 0],
    [-60, 0, "outer", "防御塔 II", 1],
    [-76, 0, "inhibitor", "水晶（不攻击）", 2],
    [-88, -4, "nexusTower", "门牙塔 I", 3],
    [-88, 4, "nexusTower", "门牙塔 II", 3],
    [-100, 0, "nexus", "核心枢纽", 4]
  ];
  for (const team of ["blue", "red"]) for (const [baseX, z, kind, name, sequence] of layouts) {
    const direction = team === "blue" ? 1 : -1;
    const structure = { kind, team, role: kind, sequence, name, x: team === "blue" ? baseX : -baseX, z, hp: kind === "nexus" ? 2600 : kind === "inhibitor" ? 1850 : kind === "nexusTower" ? 1350 : 1600, maxHp: kind === "nexus" ? 2600 : kind === "inhibitor" ? 1850 : kind === "nexusTower" ? 1350 : 1600, radius: kind === "nexus" ? 4.4 : kind === "inhibitor" ? 3.2 : kind === "nexusTower" ? 2.5 : 2.3, attackRange: kind === "outer" || kind === "nexusTower" ? 12 : 0, attackInterval: 1.5, attackTarget: null, attackTimer: .8, heatHits: 0, heatStep: .25, targetRevision: 0, visual: null, direction };
    structure.radius *= sceneScale.building;
    structures.push(structure); createStructureVisual(structure);
  }
}
setupStructures();

function moveWithBuildings(unit, dx, dz) {
  const startX = unit.x, startZ = unit.z;
  // Short steps prevent fast movement and dashes from tunnelling through bases.
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .35));
  const radius = unit.radius || 1;
  for (let step = 0; step < steps; step++) {
    unit.x = clamp(unit.x + dx / steps, world.minX + 2, world.maxX - 2);
    unit.z = clamp(unit.z + dz / steps, -7, 7);
    for (let pass = 0; pass < 3; pass++) {
      for (const building of structures) {
        if (!alive(building)) continue;
        const clearance = building.radius + radius + .05;
        let ox = unit.x - building.x, oz = unit.z - building.z;
        const length = Math.hypot(ox, oz);
        if (length >= clearance) continue;
        if (length < .0001) { ox = unit.team === "blue" ? -1 : 1; oz = 0; }
        const scale = clearance / (length < .0001 ? 1 : length);
        unit.x = building.x + ox * scale;
        unit.z = building.z + oz * scale;
      }
      unit.x = clamp(unit.x, world.minX + 2, world.maxX - 2);
      unit.z = clamp(unit.z, -7, 7);
    }
  }
  const movedX = unit.x - startX, movedZ = unit.z - startZ;
  unit.isMoving = Math.hypot(movedX, movedZ) > .001;
  if (unit.isMoving) unit.facing = Math.atan2(movedX, movedZ);
}

function blockingBuilding(unit, goal) {
  const dx = goal.x - unit.x, dz = goal.z - unit.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq < .0001) return null;
  let blocker = null, nearest = Infinity;
  for (const building of structures) {
    if (!alive(building) || building === goal) continue;
    const t = clamp(((building.x - unit.x) * dx + (building.z - unit.z) * dz) / lengthSq, 0, 1);
    const separation = Math.hypot(unit.x + dx * t - building.x, unit.z + dz * t - building.z);
    if (separation < building.radius + (unit.radius || 1) + .06 && t < nearest) { blocker = building; nearest = t; }
  }
  return blocker;
}

function navigateAroundBuildings(unit, goal, travel) {
  const direction = Math.sign(goal.x - unit.x) || (unit.team === "blue" ? 1 : -1);
  if (unit.detour && (!alive(unit.detour.building) || unit.detour.direction !== direction)) unit.detour = null;
  if (!unit.detour) {
    const building = blockingBuilding(unit, goal);
    if (building) {
      const clearance = building.radius + (unit.radius || 1) + .1;
      const sides = unit.z < building.z ? [-1, 1] : [1, -1];
      const routes = sides.map(side => [
        { x: building.x - direction * clearance, z: building.z + side * clearance },
        { x: building.x + direction * clearance, z: building.z + side * clearance }
      ]).filter(points => points.every(point => Math.abs(point.z) <= 7 && structures.every(other => !alive(other) || distance(point, other) >= other.radius + (unit.radius || 1) + .05)));
      routes.sort((a, b) => distance(unit, a[0]) + distance(a[1], goal) - distance(unit, b[0]) - distance(b[1], goal));
      if (routes.length) unit.detour = { building, direction, points: routes[0] };
    }
  }
  const waypoint = unit.detour?.points[0] || goal;
  const dx = waypoint.x - unit.x, dz = waypoint.z - unit.z;
  const length = Math.hypot(dx, dz);
  if (length > .001) { const step = Math.min(travel, length); moveWithBuildings(unit, dx / length * step, dz / length * step); }
  if (unit.detour && distance(unit, waypoint) < .15) {
    unit.detour.points.shift();
    if (!unit.detour.points.length) unit.detour = null;
  }
}

function addLimbMesh(parent, geometry, material, position, rotation = null) {
  const mesh = new THREE.Mesh(geometry, material); mesh.position.copy(position); if (rotation) mesh.rotation.set(rotation.x, rotation.y, rotation.z); mesh.castShadow = true; parent.add(mesh); return mesh;
}

function createWeaponVisual(unit, material, accent) {
  const weapon = new THREE.Group();
  const championId = unit.championId || "";
  const melee = unit.role === "melee" || championId === "MasterYi" || championId === "Garen";
  const ranged = unit.role === "ranged" || championId === "Ashe" || championId === "Jinx" || championId === "Ezreal";
  if (melee) {
    const blade = addLimbMesh(weapon, new THREE.BoxGeometry(.18, 1.65, .3), new THREE.MeshStandardMaterial({ color: 0xdaf4ff, emissive: accent, emissiveIntensity: .5, metalness: .9, roughness: .16 }), new THREE.Vector3(0, .82, 0));
    blade.rotation.z = -.12;
    addLimbMesh(weapon, new THREE.ConeGeometry(.16, .42, 4), material, new THREE.Vector3(0, 1.83, 0));
    addLimbMesh(weapon, new THREE.CylinderGeometry(.06, .06, .62, 8), material, new THREE.Vector3(0, -.25, 0), new THREE.Euler(0, 0, Math.PI / 2));
    addLimbMesh(weapon, new THREE.SphereGeometry(.13, 8, 8), new THREE.MeshBasicMaterial({ color: accent }), new THREE.Vector3(0, -.58, 0));
  } else if (ranged) {
    const bow = new THREE.Mesh(new THREE.TorusGeometry(.72, .075, 8, 24, Math.PI), new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: .45, metalness: .7, roughness: .22 }));
    bow.rotation.z = Math.PI / 2; bow.position.y = .22; bow.scale.set(.78, 1, 1); bow.castShadow = true; weapon.add(bow);
    addLimbMesh(weapon, new THREE.CylinderGeometry(.025, .025, 1.45, 6), new THREE.MeshBasicMaterial({ color: 0xf5fcff }), new THREE.Vector3(0, .22, .04), new THREE.Euler(0, 0, Math.PI / 2));
    addLimbMesh(weapon, new THREE.ConeGeometry(.09, .28, 5), new THREE.MeshBasicMaterial({ color: accent }), new THREE.Vector3(.75, .22, .04), new THREE.Euler(0, 0, -Math.PI / 2));
    addLimbMesh(weapon, new THREE.BoxGeometry(.34, .22, .62), material, new THREE.Vector3(0, -.28, 0));
  } else {
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(.065, .095, 1.9, 8), material); staff.position.y = .65; staff.castShadow = true; weapon.add(staff);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(.24, 14, 14), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: .95, blending: THREE.AdditiveBlending })); orb.position.y = 1.65; weapon.add(orb);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(.34, .035, 8, 20), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: .8, blending: THREE.AdditiveBlending })); halo.rotation.x = Math.PI / 2; halo.position.y = 1.65; weapon.add(halo);
  }
  weapon.position.set(.05, -.88, .38); weapon.rotation.x = -.1; return weapon;
}

function createHumanoidVisual(unit, group) {
  const teamColor = colorFor(unit.team);
  const bodyColor = unit.team === "blue" ? 0x227da8 : (unit.role === "mage" ? 0x7744a6 : 0xa54257);
  const armor = new THREE.MeshStandardMaterial({ color: bodyColor, emissive: teamColor, emissiveIntensity: .28, roughness: .4, metalness: .38 });
  const trim = new THREE.MeshStandardMaterial({ color: unit.team === "blue" ? 0xa7edff : 0xffb1c2, emissive: teamColor, emissiveIntensity: .35, roughness: .23, metalness: .46 });
  const dark = new THREE.MeshStandardMaterial({ color: unit.team === "blue" ? 0x102c4e : 0x3a162f, roughness: .7, metalness: .24 });
  const torso = new THREE.Group(); torso.position.y = 1.42; group.add(torso);
  addLimbMesh(torso, new THREE.CapsuleGeometry(.72, 1.18, 5, 10), armor, new THREE.Vector3(0, 0, 0));
  addLimbMesh(torso, new THREE.BoxGeometry(1.22, .26, .88), trim, new THREE.Vector3(0, .42, .05));
  const head = addLimbMesh(group, new THREE.IcosahedronGeometry(.56, 1), trim, new THREE.Vector3(0, 2.72, 0));
  const visor = addLimbMesh(group, new THREE.BoxGeometry(.62, .12, .12), dark, new THREE.Vector3(0, 2.76, .47));
  visor.rotation.x = -.12;
  const armL = new THREE.Group(); armL.position.set(-.82, 2.13, 0); group.add(armL);
  const armR = new THREE.Group(); armR.position.set(.82, 2.13, 0); group.add(armR);
  addLimbMesh(armL, new THREE.CylinderGeometry(.17, .21, .72, 8), armor, new THREE.Vector3(0, -.36, 0), new THREE.Euler(0, 0, -.18));
  addLimbMesh(armL, new THREE.CylinderGeometry(.14, .17, .65, 8), trim, new THREE.Vector3(-.11, -.98, .04), new THREE.Euler(0, 0, -.3));
  addLimbMesh(armR, new THREE.CylinderGeometry(.17, .21, .72, 8), armor, new THREE.Vector3(0, -.36, 0), new THREE.Euler(0, 0, .18));
  const forearmR = new THREE.Group(); forearmR.position.set(.11, -.73, .04); armR.add(forearmR);
  addLimbMesh(forearmR, new THREE.CylinderGeometry(.14, .17, .65, 8), trim, new THREE.Vector3(0, -.32, 0), new THREE.Euler(0, 0, .28));
  const legL = new THREE.Group(); legL.position.set(-.39, .63, 0); group.add(legL);
  const legR = new THREE.Group(); legR.position.set(.39, .63, 0); group.add(legR);
  addLimbMesh(legL, new THREE.CylinderGeometry(.2, .24, .95, 8), dark, new THREE.Vector3(0, -.48, 0));
  addLimbMesh(legL, new THREE.BoxGeometry(.34, .2, .58), trim, new THREE.Vector3(0, -.99, .15));
  addLimbMesh(legR, new THREE.CylinderGeometry(.2, .24, .95, 8), dark, new THREE.Vector3(0, -.48, 0));
  addLimbMesh(legR, new THREE.BoxGeometry(.34, .2, .58), trim, new THREE.Vector3(0, -.99, .15));
  const weapon = createWeaponVisual(unit, armor, teamColor);
  forearmR.add(weapon);
  const aura = new THREE.Mesh(new THREE.TorusGeometry(1.02, .055, 8, 32), new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: .78, blending: THREE.AdditiveBlending }));
  aura.rotation.x = Math.PI / 2; aura.position.y = .08; group.add(aura);
  group.userData.aura = aura; group.userData.parts = { torso, armL, armR, legL, legR, weapon, head, visor }; group.userData.proceduralParts = group.children.filter(child => child !== aura); group.userData.profile = profileFor(unit);
}

const healthBarParentRotation = new THREE.Quaternion();
const healthBarParentScale = new THREE.Vector3();

function createHealthBarVisual(entity, group) {
  const isStructure = entity.kind === "outer" || entity.kind === "inhibitor" || entity.kind === "nexusTower" || entity.kind === "nexus";
  const width = isStructure ? (entity.kind === "nexus" ? 5.2 : entity.kind === "inhibitor" ? 3.5 : 2.7) : entity.kind === "champion" || entity.kind === "player" ? 2.25 : entity.minionType === "super" ? 2.15 : entity.minionType === "cannon" ? 1.7 : 1.35;
  const offset = isStructure ? (entity.kind === "nexus" ? 7.1 : entity.kind === "inhibitor" ? 4.3 : 6.2) : entity.kind === "champion" || entity.kind === "player" ? 4.15 : entity.minionType === "super" ? 3.45 : entity.minionType === "cannon" ? 2.25 : 2.55;
  const bar = new THREE.Group(); bar.position.y = offset;
  const back = new THREE.Mesh(new THREE.PlaneGeometry(width, .16), new THREE.MeshBasicMaterial({ color: 0x07111d, transparent: true, opacity: .92, depthTest: false, depthWrite: false }));
  const fillColor = entity.team === "blue" ? 0x66e2ff : 0xff718e; const fill = new THREE.Mesh(new THREE.PlaneGeometry(1, .115), new THREE.MeshBasicMaterial({ color: fillColor, transparent: true, opacity: .95, depthTest: false, depthWrite: false }));
  back.renderOrder = 20; fill.renderOrder = 21;
  fill.position.z = .012; bar.add(back, fill); group.add(bar); group.userData.healthBar = { bar, fill, width: width - .06, offset };
}

function updateHealthBar(entity) {
  const visual = entity.visual;
  const data = visual?.userData?.healthBar;
  if (!data) return;
  const ratio = clamp(entity.hp / Math.max(1, entity.maxHp), 0, 1);
  data.fill.scale.x = data.width * ratio;
  data.fill.position.x = -data.width / 2 + data.width * ratio / 2;
  data.fill.visible = ratio > 0;
  data.bar.visible = alive(entity);
  // Cancel the model's transform so the bar stays a horizontal screen-facing
  // rectangle, including during turning, hit pulses and camera following.
  visual.getWorldQuaternion(healthBarParentRotation);
  data.bar.quaternion.copy(healthBarParentRotation).invert().multiply(camera.quaternion);
  visual.getWorldScale(healthBarParentScale);
  data.bar.scale.set(1 / healthBarParentScale.x, 1 / healthBarParentScale.y, 1 / healthBarParentScale.z);
}

function loadChampionModel(unit, wrapper) {
  const isMinion = unit.kind === "minion";
  const minionType = unit.minionType === "swarm" ? "melee" : unit.minionType;
  const url = isMinion ? `./models/minions/${unit.team}-${minionType}.glb` : `./models/${unit.championId}.glb`;
  if (!unitModelCache.has(url)) unitModelCache.set(url, championModelLoader.loadAsync(url));
  unitModelCache.get(url).then(gltf => {
    if (unit.visual !== wrapper) return;
    // Every unit owns its bones and mixer. Geometry and textures are shared.
    const model = cloneSkeleton(gltf.scene);
    model.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; node.frustumCulled = false; } });
    const mixer = new THREE.AnimationMixer(model);
    const clips = gltf.animations || [];
    const findClip = patterns => { for (const pattern of patterns) { const clip = clips.find(clip => pattern.test(clip.name)); if (clip) return clip; } return null; };
    const idle = findClip([/^idle1?(_base)?$/i, /idle1/i, /idle/i]);
    const run = findClip([/^run(_base|_normal)?$/i, new RegExp(`^${unit.championId}_run$`, 'i'), /^walk$/i, /^run/i, /walk/i]);
    const attack = findClip([/^attack1a?$/i, /attack1/i, /attack/i]);
    // Exported rest transforms can differ greatly from the animated pose.
    // Apply a real pose and refresh skin bounds before normalizing the size.
    if (idle) { mixer.clipAction(idle).play(); mixer.update(.01); }
    model.traverse(node => { if (node.isMesh) node.visible = node.material.userData.visible !== false; });
    const pivot = new THREE.Group(); pivot.add(model);
    const bounds = visibleModelBounds(pivot);
    const height = Math.max(1e-7, bounds.max.y - bounds.min.y);
    const desiredHeight = isMinion ? ({ melee: 1.8, caster: 1.75, cannon: 1.65, super: 2.8, swarm: 1.25 }[unit.minionType]) * sceneScale.minion : profileFor(unit).modelScale * sceneScale.hero;
    pivot.scale.setScalar(desiredHeight / height); pivot.updateMatrixWorld(true);
    // These GLB models face +Z, matching atan2(dx, dz) on the unit wrapper.
    pivot.position.y = -bounds.min.y * pivot.scale.y + .06;
    wrapper.add(pivot); wrapper.userData.modelRoot = model; wrapper.userData.modelMixer = mixer;
    wrapper.userData.modelActions = { idle, run: run || idle, attack, death: findClip([/^death$/i, /death/i]), q: findClip([/spell1/i]) || attack, w: findClip([/spell2/i]) || attack, e: findClip([/spell3/i]) || attack, r: findClip([/spell4/i]) || attack };
    wrapper.userData.healthBar.bar.position.y = desiredHeight + .65;
    for (const part of wrapper.userData.proceduralParts || []) part.visible = false;
    playModelAnimation(unit, unit.action?.type || (unit.isMoving ? "run" : "idle"), unit.action?.duration);
    if (!isMinion) addFeed(`${unit.name || unit.championId} 3D 模型已加载。`, unit.team === "blue" ? "#a7eaff" : "#ffb0c4");
  }).catch(() => { if (!isMinion) addFeed(`${unit.name || unit.championId} 模型加载失败，使用本地备用模型。`, "#ffd47f"); });
}

function createUnitVisual(unit) {
  const scale = unit.kind === 'minion' ? sceneScale.minion : sceneScale.hero;
  unit.baseRadius ??= unit.radius || 1;
  unit.radius = unit.baseRadius * scale;
  moveWithBuildings(unit, 0, 0);
  const group = new THREE.Group(); const teamColor = colorFor(unit.team);
  if (unit.kind === "champion" || unit.kind === "player") createHumanoidVisual(unit, group);
  else {
    const isSuper = unit.minionType === "super";
    const caster = unit.minionType === "caster";
    const cannon = unit.minionType === "cannon";
    const body = new THREE.Mesh(cannon ? new THREE.BoxGeometry(1.28, .74, 1.04) : new THREE.CylinderGeometry(isSuper ? .82 : caster ? .36 : .55, isSuper ? 1.02 : caster ? .52 : .68, isSuper ? 1.8 : caster ? 1.15 : 1.25, isSuper ? 8 : caster ? 5 : 6), new THREE.MeshStandardMaterial({ color: unit.team === "blue" ? (isSuper ? 0x4be0ff : cannon ? 0x4d91b8 : caster ? 0x65bddd : 0x3c83b6) : (isSuper ? 0xff557f : cannon ? 0xb84d69 : caster ? 0xd15a85 : 0xb04467), emissive: teamColor, emissiveIntensity: isSuper ? .42 : .2, roughness: .6, metalness: isSuper || cannon ? .4 : .1 }));
    body.position.y = cannon ? .62 : .8; body.castShadow = true; group.add(body);
    if (cannon) {
      const wheelMat = new THREE.MeshStandardMaterial({ color: 0x273b4c, roughness: .78, metalness: .45 });
      for (const side of [-1, 1]) { const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.28, .28, .18, 12), wheelMat); wheel.rotation.z = Math.PI / 2; wheel.position.set(side * .63, .42, -.32); wheel.castShadow = true; group.add(wheel); }
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.16, .24, 1.25, 8), new THREE.MeshStandardMaterial({ color: 0xc8e9f1, emissive: teamColor, emissiveIntensity: .25, metalness: .75, roughness: .2 })); barrel.rotation.z = Math.PI / 2; barrel.position.set(unit.team === "blue" ? .62 : -.62, 1.05, .05); barrel.castShadow = true; group.add(barrel);
      const muzzle = new THREE.Mesh(new THREE.TorusGeometry(.18, .045, 8, 16), new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: .8, blending: THREE.AdditiveBlending })); muzzle.rotation.y = Math.PI / 2; muzzle.position.set(unit.team === "blue" ? 1.25 : -1.25, 1.05, .05); group.add(muzzle);
    } else if (caster) {
      const cloak = new THREE.Mesh(new THREE.ConeGeometry(.62, 1.15, 6), new THREE.MeshStandardMaterial({ color: unit.team === "blue" ? 0x3977ae : 0x873b68, emissive: teamColor, emissiveIntensity: .25, roughness: .72 })); cloak.position.y = .7; cloak.castShadow = true; group.add(cloak);
      const staff = new THREE.Mesh(new THREE.CylinderGeometry(.045, .07, 1.5, 6), new THREE.MeshStandardMaterial({ color: 0xd6e5ed, metalness: .5, roughness: .3 })); staff.position.set(.48, 1.1, .18); staff.rotation.z = -.14; group.add(staff);
    } else if (isSuper) {
      for (const side of [-1, 1]) { const horn = new THREE.Mesh(new THREE.ConeGeometry(.18, .7, 5), new THREE.MeshStandardMaterial({ color: 0xe9fbff, emissive: teamColor, emissiveIntensity: .45, metalness: .55, roughness: .23 })); horn.position.set(side * .48, 2.05, .08); horn.rotation.z = side * -.55; group.add(horn); }
    } else {
      const shield = new THREE.Mesh(new THREE.CylinderGeometry(.38, .38, .12, 8), new THREE.MeshStandardMaterial({ color: 0xd7eff6, emissive: teamColor, emissiveIntensity: .35, metalness: .7, roughness: .25 })); shield.rotation.x = Math.PI / 2; shield.position.set(0, .9, .62); group.add(shield);
    }
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(isSuper ? .5 : caster ? .36 : cannon ? .26 : .25, 0), new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: .9, blending: THREE.AdditiveBlending }));
    crystal.position.y = isSuper ? 2.2 : cannon ? 1.3 : 1.65; group.add(crystal);
  }
  if (unit.kind === "minion") group.userData.proceduralParts = [...group.children];
  for (const part of group.children) { part.scale.multiplyScalar(scale); part.position.multiplyScalar(scale); }
  group.position.set(unit.x, 0, unit.z); group.userData.phase = Math.random() * Math.PI * 2; createHealthBarVisual(unit, group); scene.add(group); unit.visual = group; unit.facing ??= unit.team === "blue" ? Math.PI / 2 : -Math.PI / 2; loadChampionModel(unit, group); return group;
}

function spawnWave() {
  waveNumber += 1;
  const cannonWave = waveNumber % 2 === 0;
  const stats = {
    melee: { hp: 240, radius: .7, speed: 2.7, range: 2.3, damage: 25 },
    caster: { hp: 155, radius: .55, speed: 2.2, range: 7, damage: 19 },
    cannon: { hp: 470, radius: 1.05, speed: 1.7, range: 8, damage: 48 },
    super: { hp: 960, radius: 1.2, speed: 2.25, range: 2.8, damage: 72 }
  };
  for (const team of ["blue", "red"]) {
    const side = team === "blue" ? -1 : 1;
    const spawn = (type, offset, z, attackTimer) => {
      const base = stats[type];
      const unit = { kind: "minion", minionType: type, wave: waveNumber, team, x: side * (106 + offset), z: side * z, ...base, maxHp: base.hp, attackTimer, attackTarget: null, stun: 0, visual: null };
      units.push(unit); createUnitVisual(unit);
    };
    const frontSlots = cannonWave ? [-2.3, 2.3] : [-2.3, 0, 2.3];
    frontSlots.forEach((z, index) => spawn(superMinionReady[team] && index < 2 ? "super" : "melee", index * 1.4, z, index * .12));
    [-2.3, 2.3].forEach((z, index) => spawn("caster", 4, z, .3 + index * .12));
    if (cannonWave) spawn("cannon", 5.2, -4.1, .8);
  }
  const reinforced = ["blue", "red"].filter(team => superMinionReady[team]).map(team => `${team === "blue" ? "蓝方" : "红方"} 2 名前排替换为超级兵`);
  addFeed(`第 ${waveNumber} 波：${cannonWave ? "2 前排、2 远程、1 炮车" : "3 前排、2 远程"}。${reinforced.join("；")}`, "#a7dfff");
}

function updateWaves(dt) {
  waveTimer -= dt;
  while (waveTimer <= 0) { spawnWave(); waveTimer += waveInterval; }
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

function createParticleBurst(position, color, count = 8, spread = 2.4, life = .75) {
  for (let i = 0; i < count; i++) {
    const texture = i % 2 ? snowflakeFxTexture : sparkFxTexture;
    const material = new THREE.SpriteMaterial({ map: texture, color, transparent: true, opacity: .86, blending: THREE.AdditiveBlending, depthWrite: false });
    const sprite = new THREE.Sprite(material); sprite.position.copy(position); sprite.position.y += .7 + Math.random() * 1.4; sprite.scale.setScalar(.32 + Math.random() * .36); scene.add(sprite);
    effects.push({ mesh: sprite, kind: "sprite", radius: spread, life: life * (.7 + Math.random() * .45), max: life, velocity: new THREE.Vector3((Math.random() - .5) * spread, .8 + Math.random() * 2.2, (Math.random() - .5) * spread), spin: (Math.random() - .5) * 4 });
  }
}

function spawnProjectile(from, target, damageAmount, team, type = "basic", speed = 24, source = from) {
  const projectileColors = { frost: 0xd7fbff, arrow: 0xa8edff, arcane: 0x75dfff, shadow: 0xb276ff, bullet: 0xff83bf, blade: 0xffe08b, fist: 0xffc55d, ember: 0xff718e, tower: 0xffd18b, basic: team === "blue" ? 0x75dfff : 0xff718e };
  const material = new THREE.MeshBasicMaterial({ color: projectileColors[type] || (team === "blue" ? 0x75dfff : 0xff718e), blending: THREE.AdditiveBlending });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(type === "tower" ? .28 : .18, 12, 12), material); mesh.position.set(from.x, 1.35, from.z); scene.add(mesh);
  createEffect(new THREE.Vector3(from.x, 1.35, from.z), material.color.getHex(), "nova", 1, .18); createParticleBurst(new THREE.Vector3(from.x, 1.35, from.z), material.color.getHex(), 2, .55, .25);
  projectiles.push({ mesh, target, damage: damageAmount, team, type, speed, ttl: 3, source, sourceTower: type === "tower" ? from : null, targetRevision: type === "tower" ? from.targetRevision : null });
}

function gainXp(amount) {
  player.xp += amount;
  while (player.xp >= player.nextXp && player.level < 10) { player.xp -= player.nextXp; player.nextXp = Math.round(player.nextXp * 1.22); player.level += 1; player.maxHp += 80; player.maxMana += 30; player.hp = player.maxHp; player.mana = player.maxMana; player.pendingUpgrades += 1; notify(`升级！现在是 Lv.${player.level}`); addFeed(`寒星升至 Lv.${player.level}，等待选择海克斯强化。`, "#ffd47f"); }
  if (!paused && player.pendingUpgrades > 0) showUpgrade();
}

function structureGate(target) {
  if (!target || !["outer", "inhibitor", "nexusTower", "nexus"].includes(target.kind)) return null;
  return structures.find(structure => structure.team === target.team && structure.sequence < target.sequence && alive(structure)) || null;
}

function setTowerTarget(tower, target) {
  if (tower.attackTarget === target) return;
  tower.attackTarget = target;
  tower.heatHits = 0;
  tower.targetRevision += 1;
}

function provokeTowers(victim, attacker) {
  const isHero = entity => entity && (entity.kind === "player" || entity.kind === "champion");
  if (!isHero(victim) || !isHero(attacker) || !alive(attacker) || !enemyOf(victim.team, attacker)) return;
  for (const tower of structures) {
    if (alive(tower) && tower.team === victim.team && tower.attackRange > 0 && distance(tower, attacker) < tower.attackRange) {
      setTowerTarget(tower, attacker);
    }
  }
}

function damage(target, amount, sourceTeam, label = "", source = null) {
  if (!target || !alive(target)) return;
  const blocker = structureGate(target);
  if (blocker) {
    if (sourceTeam === "blue" && player.nexusGateNotice <= 0) { player.nexusGateNotice = 2.4; notify(`${target.name} 受保护：先摧毁${blocker.name}`); addFeed(`${target.name} 暂不可攻击，必须按顺序摧毁 ${blocker.name}。`, "#ffd47f"); }
    return;
  }
  if (amount > 0) provokeTowers(target, source);
  if (target === player) player.combatTimer = 0;
  if (target.visual) target.visual.userData.hitPulse = .2;
  if (target === player) { screenShake = Math.min(.55, screenShake + .22); damageFlash = Math.min(1, damageFlash + .65); createEffect(new THREE.Vector3(player.x, 1.3, player.z), 0xff6688, "ring", 1.7, .28); }
  let finalAmount = amount;
  if (target === player && player.shield > 0) { const absorbed = Math.min(player.shield, finalAmount); player.shield -= absorbed; finalAmount -= absorbed; }
  // Hero augments belong to their owner, not every unit on the blue team.
  if (source === player) { finalAmount *= player.build.allDamageMult; if (player.hp / player.maxHp < .4) finalAmount *= 1 + player.build.lowHealthBonus; if (["outer", "inhibitor", "nexusTower", "nexus"].includes(target.kind)) finalAmount *= player.build.structureDamage; }
  target.hp = Math.max(0, target.hp - finalAmount);
  if (label) addText(label, new THREE.Vector3(target.x, target.kind === "minion" ? 1.8 : 3.8, target.z), sourceTeam === "blue" ? "#c5f7ff" : "#ffb4c3");
  createEffect(new THREE.Vector3(target.x, .35, target.z), sourceTeam === "blue" ? 0x9defff : 0xff6f8c, "nova", .6, .2); createParticleBurst(new THREE.Vector3(target.x, .65, target.z), sourceTeam === "blue" ? 0x9defff : 0xff6f8c, 3, 1.2, .32);
  if (target.hp <= 0) killEntity(target, sourceTeam);
}

function killEntity(target, sourceTeam) {
  if (!target || target.hp > 0) return;
  target.isMoving = false; target.detour = null; triggerAction(target, "death"); target.deathRemaining = target.action.duration + .15;
  if (target.kind === "player") { redKills++; player.respawn = 8; addFeed("寒星倒下了，8 秒后从蓝方复活点重返战场。", "#ff9faf"); requestShop("死亡后可前往复活点商店"); }
  else if (target.kind === "champion") { target.respawn = 8; if (sourceTeam === "blue") { blueKills++; player.gold += 220; gainXp(220); if (player.build.hpOnKill) player.hp = Math.min(player.maxHp, player.hp + player.build.hpOnKill); addFeed(`${target.name} 被击败，8 秒后从红方复活点返回。`, "#a2ffe2"); } }
  else if (target.kind === "minion") { if (sourceTeam === "blue") { player.gold += target.minionType === "swarm" ? 18 : 40; gainXp(target.minionType === "caster" ? 42 : 32); if (player.build.hpOnKill) player.hp = Math.min(player.maxHp, player.hp + player.build.hpOnKill); } }
  else if (target.kind === "nexus") { gameOver = true; victory = target.team === "red"; document.getElementById("matchState").textContent = victory ? "胜利" : "失败"; document.getElementById("objectiveText").textContent = victory ? "敌方核心枢纽已崩解" : "我方核心枢纽被摧毁"; notify(victory ? "胜利 · 极地裂隙" : "失败 · 再来一局"); }
  else { if (target.kind === "inhibitor") { superMinionReady[target.team === "red" ? "blue" : "red"] = true; addFeed(`${target.name} 被摧毁，${target.team === "red" ? "蓝方" : "红方"}兵线将召唤超级兵。`, "#e1c2ff"); } if (sourceTeam === "blue") player.gold += target.kind === "inhibitor" ? 360 : target.kind === "nexusTower" ? 300 : 260; addFeed(`${target.name} 被摧毁。`, target.team === "red" ? "#a2ffe2" : "#ff9faf"); notify(target.team === "red" ? `${target.name} 已摧毁` : `${target.name} 失守`); }
}

function castAbility(key) {
  if (gameOver || paused || player.respawn > 0 || player.stun > 0 || player.cds[key] > 0) return;
  const costs = { q: 40, w: 65, e: 55, r: 100 };
  if (player.mana < costs[key]) { notify("法力不足"); return; }
  player.mana -= costs[key];
  const profile = profileFor(player); const effectColor = profile.effects[{ q: 0, w: 1, e: 2, r: 3 }[key]]; triggerAction(player, key, key === "r" ? .9 : .52); createParticleBurst(new THREE.Vector3(player.x, 1.8, player.z), effectColor, key === "r" ? 14 : 7, 1.8, .62);
  const skillScale = key === "q" ? 1 : key === "e" ? player.build.eDamageMult : key === "r" ? player.build.rDamageMult : 1;
  if (key === "q") {
    const target = nearestEnemy(player, profile.mode === "melee" ? profile.attackRange + 2 : profile.attackRange);
    if (!target) { player.mana += costs[key]; notify("射程内没有目标"); return; }
    const qDamage = (88 + player.level * 20) * player.build.qDamageMult * (profile.mode === "melee" ? 1.22 : 1);
    if (profile.mode === "melee") { const dx = target.x - player.x, dz = target.z - player.z, len = Math.hypot(dx, dz) || 1; const dash = Math.max(0, len - 1.6); moveWithBuildings(player, dx / len * dash, dz / len * dash); if (distance(player, target) <= profile.attackRange + (target.radius || 1)) { createEffect(new THREE.Vector3(target.x, .9, target.z), effectColor, "ring", 2.2, .28); damage(target, qDamage, "blue", profile.autoType === "blade" ? "剑斩" : "重拳", player); } }
    else { spawnProjectile(player, target, qDamage, "blue", profile.autoType === "arrow" ? "frost" : profile.autoType, 28); }
    player.cds.q = profile.mode === "melee" ? 3.1 : 2.3;
    if (player.build.qBounce) { const second = units.find(unit => alive(unit) && enemyOf("blue", unit) && unit !== target && distance(target, unit) < 7); if (second) setTimeout(() => spawnProjectile(target, second, 48 + player.level * 8, "blue", profile.autoType === "shadow" ? "shadow" : "frost", 25, player), 120); }
  } else if (key === "w") {
    const dx = pointerWorld.x - player.x, dz = pointerWorld.z - player.z; const len = Math.hypot(dx, dz) || 1; const jump = Math.min(19, Math.max(7, len));
    const dash = profile.mode === "mage" ? Math.min(5, jump) : profile.mode === "melee" ? jump : Math.min(12, jump); moveWithBuildings(player, dx / len * dash, dz / len * dash); player.shield = (profile.mode === "mage" ? 220 : 165) + player.level * 22 + player.build.wShieldBonus; player.cds.w = (profile.mode === "melee" ? 7 : 8) * player.build.wCooldownMult; createEffect(new THREE.Vector3(player.x, .2, player.z), effectColor, "ring", profile.mode === "melee" ? 4.5 : 5, .5); createParticleBurst(new THREE.Vector3(player.x, 1.3, player.z), effectColor, 10, 2.2, .5);
  } else if (key === "e") {
    const radius = (profile.mode === "melee" ? 6.4 : 8) + player.build.eRadius; createEffect(new THREE.Vector3(player.x, .2, player.z), effectColor, "ring", radius, .48); createParticleBurst(new THREE.Vector3(player.x, .5, player.z), effectColor, 16, radius * .35, .58);
    for (const target of [...units, ...structures]) if (alive(target) && enemyOf("blue", target) && distance(player, target) < radius) { damage(target, (profile.mode === "melee" ? 94 : 72) + player.level * 13 * skillScale, "blue", player.championId === "Morgana" ? "暗影禁锢" : player.championId === "Jinx" ? "震荡爆破" : "裂冰", player); target.stun = player.build.eFreeze ? 1.7 : profile.mode === "mage" ? 1.25 : .8; }
    player.cds.e = profile.mode === "melee" ? 7.2 : 6.5;
  } else if (key === "r") {
    const radius = (profile.mode === "melee" ? 5.5 : 7) + player.build.rRadius; createEffect(new THREE.Vector3(pointerWorld.x, .2, pointerWorld.z), effectColor, "nova", radius, .85); createEffect(new THREE.Vector3(pointerWorld.x, .2, pointerWorld.z), effectColor, "ring", radius, .85); createParticleBurst(new THREE.Vector3(pointerWorld.x, 1, pointerWorld.z), effectColor, 24, radius * .5, .9);
    for (const target of [...units, ...structures]) if (alive(target) && enemyOf("blue", target) && Math.hypot(target.x - pointerWorld.x, target.z - pointerWorld.z) < radius) damage(target, (profile.mode === "melee" ? 290 : 245) + player.level * 35 * skillScale, "blue", player.championId === "Ashe" ? "水晶箭" : player.championId === "Lux" ? "终极闪光" : "星落", player);
    player.cds.r = 18;
  }
}

function updatePlayer(dt) {
  if (player.respawn > 0) { player.respawn -= dt; if (player.respawn <= 0) { player.hp = player.maxHp; player.mana = player.maxMana; player.x = spawnPoints.blue.x; player.z = spawnPoints.blue.z; player.visual.visible = true; addFeed("寒星从蓝方复活点重返战场。", "#a7dfff"); } return; }
  player.cds.q = Math.max(0, player.cds.q - dt * (1 + player.build.manaRegen * .004)); player.cds.w = Math.max(0, player.cds.w - dt * (1 + player.build.manaRegen * .004)); player.cds.e = Math.max(0, player.cds.e - dt * (1 + player.build.manaRegen * .004)); player.cds.r = Math.max(0, player.cds.r - dt * (1 + player.build.manaRegen * .004)); player.shield = Math.max(0, player.shield - dt * 50); player.stun = Math.max(0, player.stun - dt); player.nexusGateNotice = Math.max(0, player.nexusGateNotice - dt); player.mana = Math.min(player.maxMana, player.mana + dt * player.build.manaRegen);
  if (player.stun > 0) { player.isMoving = false; return; }
  let dx = 0, dz = 0; if (keys.has("arrowleft")) dx -= 1; if (keys.has("arrowright")) dx += 1; if (keys.has("arrowup")) dz -= 1; if (keys.has("arrowdown")) dz += 1;
  if (!dx && !dz && moveTarget) { dx = moveTarget.x - player.x; dz = moveTarget.z - player.z; if (Math.hypot(dx, dz) < .7) moveTarget = null; }
  player.isMoving = false;
  const length = Math.hypot(dx, dz) || 1; if (dx || dz) moveWithBuildings(player, dx / length * player.speed * dt, dz / length * player.speed * dt);
  player.attackTimer -= dt; if (player.attackTimer <= 0) { const profile = profileFor(player); const target = nearestEnemy(player, profile.attackRange); if (target && distance(player, target) <= profile.attackRange + (target.radius || 1)) { player.facing = Math.atan2(target.x - player.x, target.z - player.z); triggerAction(player, "attack", .38); if (profile.mode === "melee") { createEffect(new THREE.Vector3(target.x, .9, target.z), profile.effects[0], "ring", 1.2, .18); damage(target, 40 + player.level * 8 + player.build.autoDamage, "blue", profile.autoType === "fist" ? "铁拳" : "普攻", player); } else spawnProjectile(player, target, 40 + player.level * 8 + player.build.autoDamage, "blue", profile.autoType === "arrow" ? "frost" : profile.autoType, 23); player.attackTimer = profile.mode === "melee" ? .84 : .72; } }
  if (relic.active && distance(player, relic) < 4) { relic.active = false; relicTimer = 13; player.hp = Math.min(player.maxHp, player.hp + 300 * player.build.relicPower); player.mana = Math.min(player.maxMana, player.mana + 160 * player.build.relicPower); notify("治疗圣坛已吸收"); addFeed("寒星获得治疗圣坛的祝福。", "#ffd47f"); }
}

function updateMinion(unit, dt) {
  if (!alive(unit)) return;
  unit.isMoving = false;
  const inRange = target => alive(target) && enemyOf(unit.team, target) && distance(unit, target) <= unit.range + (target.radius || 0);
  if (!inRange(unit.attackTarget)) unit.attackTarget = null;
  if (unit.stun > 0) { unit.stun -= dt; return; }
  unit.attackTimer -= dt;
  if (!unit.attackTarget) {
    const candidate = nearestEnemy(unit, unit.range + 3);
    if (inRange(candidate)) unit.attackTarget = candidate;
  }
  const target = unit.attackTarget;
  if (target) {
    // Hold position through the entire attack cooldown, keeping this target
    // even if another enemy moves closer. Retargeting does not reset cooldown.
    unit.detour = null;
    unit.facing = Math.atan2(target.x - unit.x, target.z - unit.z);
    if (unit.attackTimer <= 0) {
      triggerAction(unit, "attack", .55);
      if (unit.minionType === "caster" || unit.minionType === "cannon") spawnProjectile(unit, target, unit.damage, unit.team, unit.minionType === "caster" ? "arcane" : "bullet", 22);
      else damage(target, unit.damage, unit.team, `${unit.damage}`, unit);
      unit.attackTimer = unit.minionType === "caster" ? 1.35 : unit.minionType === "cannon" ? 1.7 : unit.minionType === "super" ? 1.15 : 1.05;
    }
  } else {
    const goal = spawnPoints[unit.team === "blue" ? "red" : "blue"];
    navigateAroundBuildings(unit, goal, unit.speed * dt);
  }
}

function updateChampion(unit, dt) {
  if (unit.respawn > 0) { unit.respawn -= dt; if (unit.respawn <= 0) { unit.hp = unit.maxHp; unit.x = spawnPoints.red.x + (Math.random() - .5) * 3; unit.z = (Math.random() - .5) * 5; unit.visual.visible = true; addFeed(`${unit.name} 从红方复活点返回战场。`, "#ffb3c3"); } return; }
  unit.isMoving = false; if (unit.stun > 0) { unit.stun -= dt; return; } unit.attackTimer -= dt; const target = nearestEnemy(unit, 70, false) || nearestEnemy(unit, 70, true); if (!target) return; const d = distance(unit, target);
  if (d <= unit.range + target.radius) { if (unit.attackTimer <= 0) { unit.facing = Math.atan2(target.x - unit.x, target.z - unit.z); triggerAction(unit, "attack", .42); if (unit.role === "mage") spawnProjectile(unit, target, unit.damage, "red", "ember", 16); else damage(target, unit.damage, "red", `${unit.damage}`, unit); unit.attackTimer = unit.role === "mage" ? 1.45 : 1.05; } }
  else { unit.isMoving = true; navigateAroundBuildings(unit, target, unit.speed * dt); }
}

function updateTower(structure, dt) {
  if (!alive(structure) || structure.attackRange <= 0) { setTowerTarget(structure, null); return; }
  structure.attackTimer = Math.max(0, structure.attackTimer - dt);
  const target = structure.attackTarget;
  if (!alive(target) || !enemyOf(structure.team, target) || distance(structure, target) >= structure.attackRange) {
    setTowerTarget(structure, nearestEnemy(structure, structure.attackRange, false));
  }
  // Keep one target until it dies or leaves range. Changing targets never
  // resets the cooldown, so the tower cannot burst-fire into a crowded wave.
  if (structure.attackTarget && structure.attackTimer <= 0) {
    if (structure.visual?.userData?.modelActions?.attack) triggerAction(structure, 'attack', .45);
    spawnProjectile(structure, structure.attackTarget, 85, structure.team, "tower", 19);
    structure.attackTimer = structure.attackInterval;
  }
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const projectile = projectiles[i];
    projectile.ttl -= dt;
    const target = projectile.target;
    const tower = projectile.sourceTower;
    // Tower bolts stop tracking once the target leaves the tower's circle.
    if (!alive(target) || projectile.ttl <= 0 || (tower && distance(tower, target) >= tower.attackRange)) {
      scene.remove(projectile.mesh); projectiles.splice(i, 1); continue;
    }
    const targetPosition = new THREE.Vector3(target.x, target.kind === "nexus" ? 3 : target.kind === "minion" ? 1 : 2, target.z);
    const direction = targetPosition.clone().sub(projectile.mesh.position);
    const step = projectile.speed * dt;
    if (direction.length() <= step + (target.radius || 1)) {
      let hitDamage = projectile.damage;
      const isHero = target.kind === "player" || target.kind === "champion";
      if (tower && isHero && tower.attackTarget === target && tower.targetRevision === projectile.targetRevision) {
        hitDamage *= 1 + tower.heatHits * tower.heatStep;
        tower.heatHits += 1;
      }
      damage(target, hitDamage, projectile.team, projectile.type === "frost" ? "霜矢" : projectile.type === "tower" ? `炮击 ${Math.round(hitDamage)}` : "", projectile.source);
      scene.remove(projectile.mesh); projectiles.splice(i, 1);
    } else { projectile.mesh.position.add(direction.normalize().multiplyScalar(step)); projectile.mesh.rotation.y += dt * 7; }
  }
}

function triggerAction(unit, type = "attack", duration = .48) {
  if (!unit) return;
  if (type === "death") duration = Math.min(4, unit.visual?.userData?.modelActions?.death?.duration || .85);
  unit.action = { type, time: 0, duration };
  playModelAnimation(unit, type, duration);
}

function playModelAnimation(unit, state, duration = null) {
  const data = unit.visual?.userData;
  const clip = data?.modelActions?.[state];
  if (!data?.modelMixer || !clip) return;
  const action = data.modelMixer.clipAction(clip);
  if (data.modelCurrentAction && data.modelCurrentAction !== action) data.modelCurrentAction.fadeOut(.1);
  const loop = ["idle", "run", "damaged2", "damaged3"].includes(state);
  action.reset().setEffectiveWeight(1).setEffectiveTimeScale(duration ? clip.duration / duration : 1);
  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  action.clampWhenFinished = !loop;
  action.fadeIn(.08).play();
  data.modelCurrentAction = action; data.modelState = state;
  applyModelMeshState(unit, state);
}

function updateUnitAnimation(unit, dt) {
  const data = unit.visual.userData;
  if (alive(unit) && data.modelState === "death") { unit.action = null; unit.deathRemaining = 0; playModelAnimation(unit, "idle"); }
  if (unit.action) {
    unit.action.time += dt;
    if (unit.action.time >= unit.action.duration && unit.action.type !== "death") unit.action = null;
  }
  if (!unit.action && alive(unit)) {
    const state = unit.isMoving ? "run" : unit.hp / unit.maxHp < .33 && data.modelActions?.damaged3 ? "damaged3" : unit.hp / unit.maxHp < .66 && data.modelActions?.damaged2 ? "damaged2" : "idle";
    if (data.modelState !== state) playModelAnimation(unit, state);
  }
  data.modelMixer?.update(dt);
  if (data.modelState === 'death' && data.modelCurrentAction?.paused && !data.deathSettled) {
    applyModelMeshState(unit, 'death', true); data.deathSettled = true;
  } else if (data.modelState !== 'death') data.deathSettled = false;
}

function updateHumanoidPose(unit, dt) {
  const parts = unit.visual?.userData?.parts; if (!parts) return;
  const action = unit.action;
  const actionProgress = action ? Math.min(1, action.time / action.duration) : 0;
  const actionWave = action ? Math.sin(actionProgress * Math.PI) : 0;
  const moving = unit.isMoving ? Math.sin(elapsed * 10 + unit.visual.userData.phase) : 0;
  parts.legL.rotation.x = moving * .28;
  parts.legR.rotation.x = -moving * .28;
  parts.armL.rotation.x = moving * .12;
  parts.armR.rotation.x = -moving * .12;
  parts.weapon.rotation.z = 0;
  parts.torso.rotation.z = 0;
  if (action) {
    if (action.type === "attack" || action.type === "q") {
      parts.armR.rotation.x -= actionWave * .85; parts.armR.rotation.z += actionWave * .35; parts.armL.rotation.x += actionWave * .18; parts.weapon.rotation.z -= actionWave * .45;
    } else if (action.type === "w") {
      parts.armL.rotation.x -= actionWave * 1.05; parts.armR.rotation.x -= actionWave * 1.05; parts.torso.rotation.z = Math.sin(actionProgress * Math.PI * 2) * .1;
    } else if (action.type === "e") {
      parts.armL.rotation.z -= actionWave * .65; parts.armR.rotation.z += actionWave * .65; parts.weapon.rotation.z += actionWave * .8;
    } else if (action.type === "r") {
      parts.armR.rotation.x -= actionWave * 1.3; parts.armL.rotation.x -= actionWave * .85; parts.weapon.rotation.z -= actionWave * .75; parts.torso.rotation.z = -actionWave * .12;
    }
  }
}

function updateVisuals(dt) {
  const updatePulse = entity => { if (!entity.visual) return; const data = entity.visual.userData; data.hitPulse = Math.max(0, (data.hitPulse || 0) - dt); entity.visual.scale.setScalar(1 + data.hitPulse * .32); };
  for (const unit of [player, ...units]) {
    if (!unit.visual) continue;
    const living = alive(unit);
    if (!living && !(unit.deathRemaining > 0)) {
      unit.visual.visible = false;
      if (unit.kind === "minion") {
        const data = unit.visual.userData;
        data.modelMixer?.stopAllAction();
        if (data.modelRoot) data.modelMixer?.uncacheRoot(data.modelRoot);
        data.modelRoot?.traverse(node => { if (node.isSkinnedMesh) node.skeleton.dispose(); });
        scene.remove(unit.visual); unit.visual = null; units.splice(units.indexOf(unit), 1);
      }
      continue;
    }
    unit.visual.visible = true;
    unit.visual.position.set(unit.x, 0, unit.z);
    unit.visual.rotation.set(0, unit.facing || 0, 0);
    updateUnitAnimation(unit, dt); updateHumanoidPose(unit, dt); updatePulse(unit);
    if (!living) {
      unit.deathRemaining = Math.max(0, unit.deathRemaining - dt);
      if (!unit.visual.userData.modelRoot) unit.visual.rotation.z = Math.min(1, unit.action.time / unit.action.duration) * 1.5;
    }
  }
  for (const structure of structures) if (structure.visual) {
    const data = structure.visual.userData;
    if (alive(structure) || structure.deathRemaining > 0) {
      structure.visual.visible = true; updateUnitAnimation(structure, dt); updatePulse(structure);
      if (!alive(structure)) structure.deathRemaining = Math.max(0, structure.deathRemaining - dt);
    } else structure.visual.visible = Boolean(data.modelRoot && data.modelActions?.death);
  }
  for (const actor of worldActors) if (actor.visual.userData.modelMixer && !actor.visual.userData.staticModel) updateUnitAnimation(actor, dt);
  for (const effect of effects) { effect.life -= dt; const progress = 1 - effect.life / effect.max; if (effect.kind === "sprite") { effect.mesh.position.addScaledVector(effect.velocity, dt); effect.velocity.y -= dt * 2.6; effect.mesh.material.rotation += effect.spin * dt; effect.mesh.scale.multiplyScalar(1 + dt * .8); } else { effect.mesh.scale.setScalar(effect.kind === "nova" ? .8 + progress * effect.radius : .4 + progress * effect.radius * .24); } effect.mesh.material.opacity = Math.max(0, effect.life / effect.max) * .82; if (effect.life <= 0) { scene.remove(effect.mesh); effects.splice(effects.indexOf(effect), 1); } }
  for (const floater of floaters) { floater.life -= dt; floater.position.y += dt * 2; floater.sprite.position.copy(floater.position); floater.sprite.material.opacity = Math.max(0, floater.life / floater.max); if (floater.life <= 0) { scene.remove(floater.sprite); floater.sprite.material.map?.dispose(); floaters.splice(floaters.indexOf(floater), 1); } }
}

function updateCamera() { const target = new THREE.Vector3(player.x + 2, 0, player.z); const desired = new THREE.Vector3(player.x - 24, 29, player.z + 30); const shake = screenShake; camera.position.set(desired.x + (Math.random() - .5) * shake, desired.y + (Math.random() - .5) * shake * .55, desired.z + (Math.random() - .5) * shake); camera.lookAt(target); screenShake = Math.max(0, screenShake - .045); }

function showUpgrade() {
  if (gameOver || player.pendingUpgrades <= 0) return;
  const button = document.getElementById("augmentButton"); button.classList.add("ready"); button.setAttribute("aria-label", `有 ${player.pendingUpgrades} 个海克斯强化待领取`); document.getElementById("augmentCount").textContent = player.pendingUpgrades;
}

function openUpgradeModal() {
  if (gameOver || player.pendingUpgrades <= 0) return;
  paused = true; const modal = document.getElementById("upgradeModal"); const choices = document.getElementById("upgradeChoices"); choices.innerHTML = "";
  if (!player.upgradeOptions) { const available = augmentPool.filter(item => !player.augments.includes(item.id)); player.upgradeOptions = []; while (player.upgradeOptions.length < 3 && available.length) { const index = Math.floor(Math.random() * available.length); player.upgradeOptions.push(available.splice(index, 1)[0]); } }
  for (const augment of player.upgradeOptions) { const card = document.createElement("div"); card.className = "upgrade-choice"; card.innerHTML = `<div class="rarity ${augment.rarity}">${augment.rarity === "prismatic" ? "棱彩强化" : augment.rarity === "gold" ? "黄金强化" : "白银强化"}</div><h3>${augment.name}</h3><p>${augment.desc}</p><button>选择强化</button>`; card.addEventListener("click", () => applyAugment(augment)); choices.appendChild(card); }
  modal.classList.remove("hidden");
}

function applyAugment(augment) { augment.apply(); player.augments.push(augment.id); player.pendingUpgrades = Math.max(0, player.pendingUpgrades - 1); player.upgradeOptions = null; addFeed(`获得海克斯强化：${augment.name}`, "#e1c2ff"); notify(`海克斯强化 · ${augment.name}`); document.getElementById("upgradeModal").classList.add("hidden"); updateBuildSummary(); showUpgrade(); if (player.pendingUpgrades > 0) { paused = false; addFeed("还有海克斯强化待领取，可点击右下角按钮查看。", "#e1c2ff"); } else { paused = false; requestShop("升级后可前往复活点商店"); } }
function updateBuildSummary() { document.getElementById("buildSummary").innerHTML = player.augments.length ? player.augments.map(id => { const item = augmentPool.find(a => a.id === id); return `<span class="build-chip">${item.name}</span>`; }).join("") : "尚未选择强化"; }
function shopCanOpen() { return player.respawn > 0 || distance(player, spawnPoints.blue) < 8; }
function requestShop(reason) { player.shopPending = true; player.shopReason = reason; if (!paused && player.combatTimer >= 5 && shopCanOpen()) openShop(reason); else addFeed("商店暂不可用：需要在复活点附近脱战 5 秒。", "#ffd47f"); }
function renderShop() { const container = document.getElementById("shopItems"); document.getElementById("shopGold").textContent = `${player.gold} 金币`; container.innerHTML = shopItems.map(item => `<div class="shop-item"><h3>${item.name}</h3><div class="cost">${item.cost} 金币</div><p>${item.desc}</p><button data-shop-item="${item.id}" ${player.gold < item.cost ? "disabled" : ""}>购买</button></div>`).join(""); container.querySelectorAll("[data-shop-item]").forEach(button => button.addEventListener("click", () => buyShopItem(button.dataset.shopItem))); }
function animateShop(open) {
  for (const actor of Object.values(shopActors.blue)) {
    const actions = actor.visual.userData.modelActions;
    if (!actions) continue;
    const resting = open ? actions.opened : actions.closed;
    if (resting) actions.idle = resting;
    if (actions[open ? 'open' : 'close']) triggerAction(actor, open ? 'open' : 'close', .9);
  }
}
function openShop(reason) { if (gameOver || player.combatTimer < 5 || !shopCanOpen()) return; player.shopPending = false; paused = true; animateShop(true); document.getElementById("shopReason").innerHTML = `${reason} · 已脱战 ${Math.floor(player.combatTimer)} 秒 · <b id="shopGold">${player.gold} 金币</b>`; document.getElementById("shopModal").classList.remove("hidden"); renderShop(); }
function buyShopItem(id) { const item = shopItems.find(entry => entry.id === id); if (!item || player.gold < item.cost) { notify("金币不足"); return; } player.gold -= item.cost; item.buy(); player.items.push(item.id); addFeed(`购买装备：${item.name}`, "#ffd47f"); notify(`已购买 · ${item.name}`); renderShop(); updateHud(); }
function closeShop() { document.getElementById("shopModal").classList.add("hidden"); animateShop(false); paused = false; }
function updateItemSummary() { document.getElementById("itemSummary").innerHTML = player.items.length ? player.items.map(id => { const item = shopItems.find(entry => entry.id === id); return `<span class="build-chip">${item.name}</span>`; }).join("") : "尚未购买装备"; }

function chooseChampion(champion) {
  player.championId = champion.id; player.role = champion.roleId; player.name = champion.name; player.abilityNames = champion.skills; player.maxHp = champion.hp; player.maxMana = champion.mana; player.hp = champion.hp; player.mana = champion.mana; player.speed = champion.speed;
  document.getElementById("championName").textContent = champion.name; document.getElementById("championPortrait").src = `${championAssetRoot}${champion.id}.png`; ["q", "w", "e", "r"].forEach((key, index) => { document.getElementById(`${key}Name`).textContent = champion.skills[index]; }); setSpellIcons(champion.id);
  if (player.visual) scene.remove(player.visual); player.visual = createUnitVisual(player); player.visual.visible = true;
  document.getElementById("championModal").style.display = "none"; document.getElementById("matchState").textContent = `${champion.name} · 战斗进行中`; paused = false; notify(`${champion.name} 加入极地裂隙`);
}

function setSpellIcons(championId) {
  const icons = championSpellIcons[championId] || championSpellIcons.Ashe;
  ["q", "w", "e", "r"].forEach((key, index) => { const image = document.getElementById(`${key}Icon`); image.src = `${spellAssetRoot}${icons[index]}.png`; image.onerror = () => { image.style.display = "none"; }; image.onload = () => { image.style.display = "block"; }; });
}

function setupChampionSelect() {
  const choices = document.getElementById("championChoices"); choices.innerHTML = "";
  for (const champion of championPool) { const card = document.createElement("button"); card.className = "champion-card"; card.innerHTML = `<img src="${championAssetRoot}${champion.id}.png" alt="${champion.name}"><div class="champion-copy"><h3>${champion.name}</h3><div class="champion-role">${champion.role} · ${champion.hp} 生命</div><p>${champion.description}</p></div>`; card.addEventListener("click", () => chooseChampion(champion)); choices.appendChild(card); }
}

function updateMinimap() {
  const canvas = document.getElementById("minimap"); if (!canvas) return; const ctx = canvas.getContext("2d"); const width = canvas.width, height = canvas.height;
  const mapX = x => 10 + (x - world.minX) / (world.maxX - world.minX) * (width - 20); const mapZ = z => height / 2 + z / 10 * (height * .38);
  ctx.clearRect(0, 0, width, height); ctx.fillStyle = "#071722"; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(129,220,246,.16)"; ctx.lineWidth = 1; ctx.strokeRect(10, height / 2 - 22, width - 20, 44); ctx.strokeStyle = "rgba(125,212,240,.12)"; ctx.beginPath(); ctx.moveTo(width / 2, height / 2 - 22); ctx.lineTo(width / 2, height / 2 + 22); ctx.stroke();
  const drawPoint = (x, z, color, radius, shape = "dot", alpha = 1) => { const px = mapX(x), pz = mapZ(z); ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.strokeStyle = color; ctx.shadowBlur = shape === "structure" ? 8 : 4; ctx.shadowColor = color; ctx.beginPath(); if (shape === "structure") ctx.rect(px - radius, pz - radius, radius * 2, radius * 2); else if (shape === "diamond") { ctx.moveTo(px, pz - radius); ctx.lineTo(px + radius, pz); ctx.lineTo(px, pz + radius); ctx.lineTo(px - radius, pz); ctx.closePath(); } else if (shape === "star") { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? radius * .45 : radius; ctx.lineTo(px + Math.cos(a) * r, pz + Math.sin(a) * r); } ctx.closePath(); } else ctx.arc(px, pz, radius, 0, Math.PI * 2); ctx.fill(); ctx.restore(); };
  for (const structure of structures) if (structure.hp > 0) drawPoint(structure.x, structure.z, structure.team === "blue" ? "#79e2ff" : "#ff708c", structure.kind === "nexus" ? 4 : structure.kind === "inhibitor" ? 3 : 2, "structure");
  for (const unit of units) if (alive(unit)) { const color = unit.team === "blue" ? "#79e2ff" : "#ff708c"; const shape = unit.kind === "champion" ? "diamond" : unit.minionType === "super" ? "star" : unit.minionType === "cannon" ? "structure" : unit.minionType === "caster" ? "diamond" : "dot"; drawPoint(unit.x, unit.z, color, unit.kind === "champion" ? 3 : unit.minionType === "super" ? 3.5 : 1.6, shape); }
  if (relic.active) drawPoint(relic.x, relic.z, "#ffd47f", 2.2, "star"); drawPoint(player.x, player.z, "#f7ffff", 3.2, "diamond");
}

const relic = { x: 0, z: 4.5, active: true, visual: null };
relic.visual = new THREE.Group(); const relicBase = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.5, .35, 8), new THREE.MeshStandardMaterial({ color: 0x8b6631, emissive: 0xffc65d, emissiveIntensity: .45, metalness: .65 })); relicBase.position.y = .2; relic.visual.add(relicBase); const relicCrystal = createCrystal(0xffd06e, .75); relicCrystal.position.y = 1.3; relic.visual.add(relicCrystal); relic.visual.position.set(relic.x, 0, relic.z); scene.add(relic.visual);

player.visual = createUnitVisual(player);
const champions = [{ kind: "champion", championId: "Garen", team: "red", name: "赤焰守卫", role: "melee", x: 84, z: -3.2, hp: 980, maxHp: 980, radius: 1.2, speed: 4.7, range: 4.4, damage: 34, attackTimer: 1, respawn: 0, stun: 0, visual: null }, { kind: "champion", championId: "Morgana", team: "red", name: "暮光术士", role: "mage", x: 91, z: 3.3, hp: 620, maxHp: 620, radius: 1, speed: 5.6, range: 25, damage: 52, attackTimer: 1.2, respawn: 0, stun: 0, visual: null }];
champions.forEach(champion => { units.push(champion); createUnitVisual(champion); });
spawnWave();

function updateHud() {
  document.getElementById("blueScore").textContent = `${blueKills} 击杀`; document.getElementById("redScore").textContent = `${redKills} 击杀`; document.getElementById("levelText").textContent = `Lv.${player.level}`; document.getElementById("hpFill").style.width = `${clamp(player.hp / player.maxHp, 0, 1) * 100}%`; document.getElementById("manaFill").style.width = `${clamp(player.mana / player.maxMana, 0, 1) * 100}%`; document.getElementById("hpText").textContent = `${Math.ceil(player.hp)} / ${player.maxHp}`; document.getElementById("manaText").textContent = `${Math.ceil(player.mana)} / ${player.maxMana}`; updateMinimap();
  for (const key of ["q", "w", "e", "r"]) { const card = document.querySelector(`[data-key="${key}"]`); card.classList.toggle("cooldown", player.cds[key] > 0); document.getElementById(`${key}Cd`).textContent = player.cds[key] > 0 ? player.cds[key].toFixed(1) : ""; }
  const augmentButton = document.getElementById("augmentButton"); augmentButton.classList.toggle("ready", player.pendingUpgrades > 0); document.getElementById("augmentCount").textContent = player.pendingUpgrades;
  const blueNexus = structures.find(s => s.team === "blue" && s.kind === "nexus"); const redNexus = structures.find(s => s.team === "red" && s.kind === "nexus"); document.getElementById("blueNexusFill").style.width = `${blueNexus.hp / blueNexus.maxHp * 100}%`; document.getElementById("redNexusFill").style.width = `${redNexus.hp / redNexus.maxHp * 100}%`; document.getElementById("blueNexusText").textContent = Math.ceil(blueNexus.hp); document.getElementById("redNexusText").textContent = Math.ceil(redNexus.hp); document.getElementById("relicState").textContent = relic.active ? "中央治疗圣坛：可拾取" : `中央治疗圣坛：${Math.ceil(relicTimer)} 秒后重生`; document.getElementById("goldText").textContent = `${player.gold} 金币`; updateItemSummary(); document.getElementById("feed").innerHTML = feed.map(item => typeof item === "string" ? `<p>${item}</p>` : `<p style="color:${item.color}">${item.text}</p>`).join("");
}

function update(dt) {
  if (!paused && !gameOver) { elapsed += dt; player.combatTimer += dt; updateWaves(dt); if (!relic.active) { relicTimer -= dt; if (relicTimer <= 0) { relic.active = true; relic.visual.visible = true; addFeed("中央治疗圣坛重新激活。", "#ffd47f"); } } updatePlayer(dt); for (const unit of units) { if (unit.kind === "minion") updateMinion(unit, dt); else if (unit.kind === "champion") updateChampion(unit, dt); } for (const structure of structures) if (structure.kind !== "nexus") updateTower(structure, dt); updateProjectiles(dt); if (player.shopPending && player.combatTimer >= 5 && shopCanOpen()) openShop(player.shopReason); }
  if (relic.active) { relic.visual.visible = true; relic.visual.rotation.y += dt * 1.2; relic.visual.position.y = Math.sin(elapsed * 2) * .08; } else relic.visual.visible = false;
  for (const point of Object.values(spawnPoints)) if (point.visual) { point.visual.userData.ring.rotation.z += dt * (point === spawnPoints.blue ? 1 : -1); point.visual.userData.ring.material.opacity = .62 + Math.sin(elapsed * 2.4) * .2; }
  updateVisuals(dt); updateCamera();
  for (const entity of [player, ...units, ...structures]) updateHealthBar(entity);
  damageFlash = Math.max(0, damageFlash - dt * 2.8); const flash = document.getElementById("damageFlash"); if (flash) flash.style.opacity = damageFlash.toFixed(3); if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) document.getElementById("toast").classList.remove("show"); } updateHud();
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
document.getElementById("augmentButton").addEventListener("click", openUpgradeModal);
document.getElementById("championPortrait").addEventListener("error", event => { event.currentTarget.style.display = "none"; });

resize(); updateBuildSummary(); updateItemSummary(); setSpellIcons("Ashe"); updateHud(); setupChampionSelect(); paused = true;
let previous = performance.now();
function frame(now) { const dt = Math.min(.04, (now - previous) / 1000); previous = now; update(dt); render(); requestAnimationFrame(frame); }
requestAnimationFrame(frame);

