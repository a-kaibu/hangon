// WebGL (Three.js) による 3D 卓の描画
// 座標系: 卓面が XZ 平面、Y が上。牌の幅を 1 とする。自分 (seat 0) は +Z 側。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { kindOf, isRed, WIND_NAMES } from './tile.js';

const TW = 1; // 幅
const TH = 1.36; // 高さ (面の縦)
const TD = 0.78; // 厚み
const CONSOLE = 6.6; // 中央パネルの一辺
const RIVER0 = CONSOLE / 2 + 0.3; // 河の開始位置
const HAND_Z = 8.7; // 相手手牌の位置
const TABLE = 10.4; // 卓の半分の大きさ

const SUIT_FILE = ['m', 'p', 's'];
function faceUrl(k, red) {
  if (k >= 27) return `tiles/z${k - 26}.svg`;
  return `tiles/${SUIT_FILE[Math.floor(k / 9)]}${red ? 0 : (k % 9) + 1}.svg`;
}

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

export class Board3D {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'board3d-canvas';
    container.appendChild(this.canvas);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.tiles = new Map(); // id -> { group, kind, red }
    this.anims = [];
    this.textures = new Map();
    this.raf = 0;

    this.buildMaterials();
    this.buildScene();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  // ---------- 素材 ----------
  buildMaterials() {
    this.geoFront = new RoundedBoxGeometry(TW, TD * 0.68, TH, 3, 0.09);
    this.geoBack = new RoundedBoxGeometry(TW, TD * 0.36, TH, 3, 0.09);
    this.geoFace = new THREE.PlaneGeometry(TW * 0.9, TH * 0.9);
    this.matIvory = new THREE.MeshStandardMaterial({ color: 0xf7f4ec, roughness: 0.38, metalness: 0.0 });
    this.matBack = new THREE.MeshStandardMaterial({ color: 0x2b7f8a, roughness: 0.45, metalness: 0.05 });
    this.matDim = new THREE.MeshStandardMaterial({ color: 0xb8b4aa, roughness: 0.5 });
    this.faceMats = new Map();
  }

  faceMaterial(k, red) {
    const key = `${k}${red ? 'r' : ''}`;
    if (this.faceMats.has(key)) return this.faceMats.get(key);
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 320;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      roughness: 0.4,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      tex.needsUpdate = true;
      this.requestRender();
    };
    img.src = faceUrl(k, red);
    this.faceMats.set(key, mat);
    return mat;
  }

  makeTile(k, red) {
    // 原点 = 牌の中心。面 (表) が +Y を向いた寝かせた状態が基準。
    const g = new THREE.Group();
    const front = new THREE.Mesh(this.geoFront, this.matIvory);
    front.position.y = TD / 2 - (TD * 0.68) / 2;
    const back = new THREE.Mesh(this.geoBack, this.matBack);
    back.position.y = -TD / 2 + (TD * 0.36) / 2;
    const face = new THREE.Mesh(this.geoFace, this.faceMaterial(k, red));
    face.rotation.x = -Math.PI / 2;
    face.position.y = TD / 2 + 0.002;
    for (const m of [front, back]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    g.add(front, back, face);
    g.userData = { front, face };
    return g;
  }

  // ---------- 卓 ----------
  buildScene() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xdff4ff, 0x1b2a2e, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-6, 22, 12);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -15;
    sc.right = 15;
    sc.top = 15;
    sc.bottom = -15;
    sc.near = 1;
    sc.far = 60;
    key.shadow.bias = -0.0004;
    key.shadow.radius = 4;
    s.add(key);
    const fill = new THREE.DirectionalLight(0xffe2b8, 0.5);
    fill.position.set(10, 8, -6);
    s.add(fill);

    // フェルト
    const feltTex = this.feltTexture();
    const felt = new THREE.Mesh(
      new THREE.PlaneGeometry(TABLE * 2, TABLE * 2),
      new THREE.MeshStandardMaterial({ map: feltTex, roughness: 0.95, metalness: 0 }),
    );
    felt.rotation.x = -Math.PI / 2;
    felt.receiveShadow = true;
    s.add(felt);

    // 木の縁
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.55, metalness: 0.05 });
    const rimW = 0.9,
      rimH = 0.9;
    for (let i = 0; i < 4; i++) {
      const rim = new THREE.Mesh(new RoundedBoxGeometry(TABLE * 2 + rimW * 2, rimH, rimW, 3, 0.18), wood);
      const a = (i * Math.PI) / 2;
      rim.position.set(Math.sin(a) * (TABLE + rimW / 2), rimH / 2 - 0.15, Math.cos(a) * (TABLE + rimW / 2));
      rim.rotation.y = a;
      rim.castShadow = true;
      rim.receiveShadow = true;
      s.add(rim);
    }

    // 中央パネル
    this.consoleCanvas = document.createElement('canvas');
    this.consoleCanvas.width = 1024;
    this.consoleCanvas.height = 1024;
    this.consoleTex = new THREE.CanvasTexture(this.consoleCanvas);
    this.consoleTex.colorSpace = THREE.SRGBColorSpace;
    this.consoleTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const body = new THREE.Mesh(
      new RoundedBoxGeometry(CONSOLE, 0.5, CONSOLE, 4, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x0c1a1f, roughness: 0.3, metalness: 0.35 }),
    );
    body.position.y = 0.25;
    body.castShadow = true;
    body.receiveShadow = true;
    s.add(body);
    const top = new THREE.Mesh(
      new THREE.PlaneGeometry(CONSOLE - 0.3, CONSOLE - 0.3),
      new THREE.MeshStandardMaterial({
        map: this.consoleTex,
        roughness: 0.35,
        metalness: 0.1,
        emissive: 0xffffff,
        emissiveMap: this.consoleTex,
        emissiveIntensity: 0.35,
      }),
    );
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.502;
    s.add(top);

    // 最後の捨て牌マーカー
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.26, 24),
      new THREE.MeshBasicMaterial({ color: 0xffc94d, side: THREE.DoubleSide }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    s.add(this.marker);

    // リーチ棒
    this.sticks = [];
    const stickMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const dotMat = new THREE.MeshStandardMaterial({ color: 0xd8342b, roughness: 0.4 });
    for (let rel = 0; rel < 4; rel++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new RoundedBoxGeometry(3.4, 0.12, 0.32, 2, 0.05), stickMat));
      const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.13, 16), dotMat);
      g.add(dot);
      const a = (rel * Math.PI) / 2;
      const r = CONSOLE / 2 - 0.55;
      g.position.set(Math.sin(a) * r, 0.58, Math.cos(a) * r);
      g.rotation.y = a;
      g.visible = false;
      g.children.forEach((m) => (m.castShadow = true));
      s.add(g);
      this.sticks.push(g);
    }
  }

  feltTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const ctx = c.getContext('2d');
    const grd = ctx.createRadialGradient(256, 256, 40, 256, 256, 360);
    grd.addColorStop(0, '#2a6670');
    grd.addColorStop(1, '#173c44');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 512, 512);
    // 繊維感のノイズ
    const img = ctx.getImageData(0, 0, 512, 512);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 14;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    ctx.strokeRect(14, 14, 484, 484);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  drawConsole(g, turnSeat) {
    const c = this.consoleCanvas;
    const ctx = c.getContext('2d');
    const W = c.width;
    ctx.clearRect(0, 0, W, W);
    const grd = ctx.createLinearGradient(0, 0, 0, W);
    grd.addColorStop(0, '#13262c');
    grd.addColorStop(1, '#0a161a');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, W);
    ctx.strokeStyle = 'rgba(227,180,92,0.45)';
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, W - 20, W - 20);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const font = (px, w = 700) => `${w} ${px}px system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif`;
    // 局情報
    ctx.fillStyle = '#f0cf8a';
    ctx.font = font(120, 800);
    ctx.fillText(g.roundLabel(), W / 2, W / 2 - 250);
    ctx.fillStyle = '#9fb3b0';
    ctx.font = font(56);
    ctx.fillText(`${g.honba}本場  供託 ${g.riichiSticks}`, W / 2, W / 2 - 160);
    ctx.fillStyle = '#ecf1ee';
    ctx.font = font(64, 800);
    ctx.fillText(`残り ${g.wallRemaining}`, W / 2, W / 2 - 75);
    // ドラ表示牌の置き場
    const slotW = (W / (CONSOLE - 0.3)) * 1.02;
    const slotY = W / 2 + (1.15 / (CONSOLE - 0.3)) * W;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i < 5; i++) {
      const cx = W / 2 + (i - 2) * slotW;
      ctx.beginPath();
      ctx.roundRect(cx - slotW * 0.47, slotY - slotW * 0.66, slotW * 0.94, slotW * 1.32, 10);
      ctx.fill();
    }
    ctx.fillStyle = '#9fb3b0';
    ctx.font = font(36);
    ctx.fillText('ドラ表示', W / 2, slotY - slotW * 0.66 - 28);
    // 各家の点数 (視点は自分から読める向き)
    const pos = [
      [W / 2, W - 110],
      [W - 125, W / 2 - 60],
      [W / 2 + 250, 110],
      [125, W / 2 - 60],
    ];
    for (let seat = 0; seat < 4; seat++) {
      const [x, y] = pos[seat];
      const wind = WIND_NAMES[g.seatWind(seat) - 27];
      const active = seat === turnSeat;
      if (active) {
        ctx.fillStyle = 'rgba(240,207,138,0.16)';
        ctx.beginPath();
        ctx.roundRect(x - 120, y - 74, 240, 148, 24);
        ctx.fill();
      }
      ctx.font = font(58, 800);
      ctx.fillStyle = seat === g.dealer ? '#ff6b5e' : '#9fb3b0';
      ctx.fillText(wind, x, y - 32);
      ctx.font = font(64, 800);
      ctx.fillStyle = active ? '#f0cf8a' : '#ecf1ee';
      ctx.fillText(String(g.scores[seat]), x, y + 34);
    }
    // 手番の辺を光らせる
    if (turnSeat >= 0) {
      ctx.fillStyle = '#f0cf8a';
      const L = 360,
        T = 14;
      if (turnSeat === 0) ctx.fillRect(W / 2 - L / 2, W - T - 4, L, T);
      if (turnSeat === 2) ctx.fillRect(W / 2 - L / 2, 4, L, T);
      if (turnSeat === 1) ctx.fillRect(W - T - 4, W / 2 - L / 2, T, L);
      if (turnSeat === 3) ctx.fillRect(4, W / 2 - L / 2, T, L);
    }
    this.consoleTex.needsUpdate = true;
  }

  // ---------- 配置 ----------
  // 各家のローカル座標 (x: 左右, z: 中央からの距離) をワールドへ
  toWorld(rel, x, z) {
    const a = (rel * Math.PI) / 2;
    const cos = Math.cos(a),
      sin = Math.sin(a);
    return new THREE.Vector3(x * cos + z * sin, 0, -x * sin + z * cos);
  }

  update(g, { reveal = false, lastDiscardId = null, turnSeat = -1 } = {}) {
    if (!g.players) return;
    const targets = new Map();
    const place = (id, rel, x, z, pose, extraRot = 0, opts = {}) => {
      const p = this.toWorld(rel, x, z);
      let y, rx;
      if (pose === 'stand') {
        y = TH / 2;
        rx = Math.PI / 2;
      } else if (pose === 'down') {
        y = TD / 2;
        rx = Math.PI;
      } else {
        y = TD / 2 + (opts.lift || 0);
        rx = 0;
      }
      p.y = y + (opts.baseY || 0);
      targets.set(id, { pos: p, rx, ry: (rel * Math.PI) / 2 + extraRot, dim: !!opts.dim, origin: opts.origin });
    };

    // ドラ表示牌 (中央パネルの上)
    const doraX0 = -2 * TW;
    for (let i = 0; i < 5; i++) {
      const id = g.doraIndicators[i];
      if (id === undefined) continue;
      place(id, 0, doraX0 + i * TW * 1.02, 1.15, 'flat', 0, { baseY: 0.5 });
    }

    for (let seat = 0; seat < 4; seat++) {
      const rel = seat;
      const p = g.players[seat];
      // 河
      let row = 0,
        x = -3 * TW;
      p.discards.forEach((d, i) => {
        if (i > 0 && i % 6 === 0 && row < 3) {
          row++;
          x = -3 * TW;
        }
        const side = d.riichi;
        const w = side ? TH : TW;
        const z = RIVER0 + row * TH + TH / 2 + (side ? (TH - TW) / 2 : 0);
        if (!d.called) place(d.id, rel, x + w / 2, z, 'flat', side ? -Math.PI / 2 : 0, { origin: this.toWorld(rel, 0, HAND_Z) });
        x += w + 0.02;
      });
      // 鳴き (右手前)
      let mx = TABLE - 0.7;
      const mz = TABLE - 0.95;
      for (const m of p.melds) {
        const relFrom = (m.from - seat + 4) % 4;
        let ids = m.ids.filter((i) => i !== m.called && i !== m.added);
        if (m.type === 'chi') ids.sort((a, b) => a - b);
        const order = m.type === 'ankan' ? m.ids.slice() : ids.slice();
        if (m.type !== 'ankan') {
          const pos = relFrom === 3 ? 0 : relFrom === 2 ? 1 : order.length;
          order.splice(pos, 0, { called: m.called });
        }
        for (let i = order.length - 1; i >= 0; i--) {
          const it = order[i];
          if (typeof it === 'object') {
            mx -= TH / 2;
            place(it.called, rel, mx, mz + (TH - TW) / 2, 'flat', -Math.PI / 2);
            if (m.type === 'kakan') place(m.added, rel, mx, mz + (TH - TW) / 2 - TW - 0.02, 'flat', -Math.PI / 2);
            mx -= TH / 2 + 0.03;
          } else {
            mx -= TW / 2;
            const down = m.type === 'ankan' && (i === 0 || i === 3);
            place(it, rel, mx, mz, down ? 'down' : 'flat');
            mx -= TW / 2 + 0.03;
          }
        }
        mx -= 0.3;
      }
      // 手牌 (自分は画面下の手牌 UI で表示するので 3D では出さない)
      if (rel !== 0) {
        const hand = p.hand.slice().sort((a, b) => a - b);
        const n = hand.length;
        const offset = -((n * TW) / 2) - (p.melds.length ? 1.6 : 0);
        hand.forEach((id, i) => {
          const isDrawn = id === p.drawn;
          const xx = offset + i * TW + TW / 2 + (isDrawn ? 0.3 : 0);
          if (reveal) place(id, rel, xx, HAND_Z - 0.3, 'flat');
          else place(id, rel, xx, HAND_Z, 'stand');
        });
      }
    }

    // メッシュの追加・移動・削除
    const now = performance.now();
    for (const [id, t] of targets) {
      let entry = this.tiles.get(id);
      if (!entry) {
        const group = this.makeTile(kindOf(id), isRed(id));
        this.scene.add(group);
        entry = { group };
        this.tiles.set(id, entry);
        const from = t.origin ? t.origin.clone().setY(1.5) : t.pos.clone();
        group.position.copy(from);
        group.rotation.set(t.rx, t.ry, 0, 'YXZ');
      }
      const gr = entry.group;
      const moved =
        gr.position.distanceTo(t.pos) > 0.001 || Math.abs(gr.rotation.x - t.rx) > 0.001 || Math.abs(gr.rotation.y - t.ry) > 0.001;
      if (moved) {
        this.anims = this.anims.filter((a) => a.group !== gr);
        this.anims.push({
          group: gr,
          from: gr.position.clone(),
          to: t.pos,
          rx0: gr.rotation.x,
          rx1: t.rx,
          ry0: gr.rotation.y,
          ry1: t.ry,
          t0: now,
          dur: 240,
        });
      }
    }
    for (const [id, entry] of this.tiles) {
      if (!targets.has(id)) {
        this.scene.remove(entry.group);
        this.tiles.delete(id);
        this.anims = this.anims.filter((a) => a.group !== entry.group);
      }
    }

    // 最後の捨て牌
    const last = lastDiscardId !== null && targets.get(lastDiscardId);
    if (last) {
      this.marker.visible = true;
      this.marker.position.set(last.pos.x, TD + 0.05, last.pos.z);
      this.markerTarget = lastDiscardId;
    } else {
      this.marker.visible = false;
    }
    this.sticks.forEach((st, rel) => (st.visible = !!g.players[rel].riichiPaid));
    this.drawConsole(g, turnSeat);
    this.requestRender();
  }

  // ---------- 描画ループ ----------
  requestRender() {
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  frame() {
    this.raf = 0;
    const now = performance.now();
    this.anims = this.anims.filter((a) => {
      const k = Math.min(1, (now - a.t0) / a.dur);
      const e = 1 - Math.pow(1 - k, 3);
      a.group.position.lerpVectors(a.from, a.to, e);
      // 移動中は少し持ち上げる
      a.group.position.y += Math.sin(Math.PI * k) * 0.6 * (a.from.distanceTo(a.to) > 2 ? 1 : 0);
      a.group.rotation.set(a.rx0 + (a.rx1 - a.rx0) * e, a.ry0 + shortAngle(a.ry0, a.ry1) * e, 0, 'YXZ');
      return k < 1;
    });
    if (this.marker.visible) {
      const t = this.tiles.get(this.markerTarget);
      if (t) this.marker.position.set(t.group.position.x, t.group.position.y + TD / 2 + 0.04, t.group.position.z);
      this.marker.material.opacity = 1;
    }
    this.renderer.render(this.scene, this.camera);
    if (this.anims.length) this.requestRender();
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // 卓全体が収まる距離にカメラを置く (手前の自分の手牌は画面下の UI に出すので少し切る)
    // 縦長画面では卓の端を少し切って河を大きく見せる
    const portrait = this.camera.aspect < 1;
    const halfW = portrait ? 8.6 : TABLE + 0.8;
    const vfov = (this.camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const distW = halfW / Math.tan(hfov / 2);
    const distH = ((portrait ? 8.6 : TABLE) * 0.86) / Math.tan(vfov / 2);
    const dist = Math.max(distW, distH);
    const elev = ((portrait ? 68 : 60) * Math.PI) / 180; // 見下ろし角 (縦画面は真上寄り)
    const look = new THREE.Vector3(0, 0, 0.6);
    this.camera.position.set(0, Math.sin(elev) * dist, Math.cos(elev) * dist + look.z);
    this.camera.lookAt(look);
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  // 画面上の各家の位置 (コールアウト用)
  seatScreenPos(rel) {
    const p = this.toWorld(rel, 0, RIVER0 + 2);
    p.y = 1;
    p.project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return [r.left + ((p.x + 1) / 2) * r.width, r.top + ((1 - p.y) / 2) * r.height];
  }

  dispose() {
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
    this.canvas.remove();
  }
}

function shortAngle(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
