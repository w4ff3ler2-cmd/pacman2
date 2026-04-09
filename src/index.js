require('fast-text-encoding');
require('aframe');
require('aframe-extras');
require('aframe-particle-system-component');

import {intersections, maze} from './config.js';
import {Howl} from 'howler';

const powerDuration = {
  speed: 5000,
  kill: 5000,
  freeze: 5000
};
const chaseDuration = 80;
const scatterDuration = 90;
const flashDurationMs = 1500;

const startX = -6.4;
const startZ = -7.3;
const y = 0.8;
const step = .515;
const radius = .1;
const row = 29;
const col = 26;
const P = {
  WALL: -1,
  ROAD: 0,
  PELLET: 1,
  POWERPILL: 2,
  POWER_KILL: 2,
  POWER_SPEED: 3,
  POWER_FREEZE: 4
};
const pColor = '#FFB897';
const gColor = 0x2121DE;
const gNormSpeed = 0.65;
const gSlowSpeed = 0.2;
const gFastSpeed = 1.5;
const gCollideDist = 0.6;
const ghostChaseRadius = step * 3;
const closeProximityDist = 1.2;
const pelletScore = 10;
const pillScore = 50;
const ghostScore = 200;

let path = [];
let pCnt = 0;
let totalP = 0;
let targetPos;
let dead = true;
let lifeCnt = 3;
let highScore;
let score = 0;
let pillCnt = 0;
let activePowerType = null;
let soundCtrl = true;
let stageLevel = 1;
let ghostDefeatedCnt = 0;
let stageScoreStart = 0;
let stageTargetScore = 0;
let stageTransitioning = false;
let minimapCanvas;
let minimapCtx;

const siren = new Howl({
  src: ['assets/sounds/siren.mp3'],
  loop: true
});

const ghostEaten = new Howl({
  src: 'assets/sounds/ghost-eaten.mp3',
  loop: true
});

const waza = new Howl({
  src: 'assets/sounds/waza.mp3',
  loop: true
});

const ready = new Howl({
  src: ['assets/sounds/ready.mp3'],
  onend: () => {
    ready.stop();
    siren.play();
  }
});

const eating = new Howl({src: 'assets/sounds/eating.mp3'});
const eatPill = new Howl({src: 'assets/sounds/eat-pill.mp3'});
const eatGhost = new Howl({src: 'assets/sounds/eat-ghost.mp3'});
const die = new Howl({src: 'assets/sounds/die.mp3'});

AFRAME.registerComponent('maze', {
  init: function () {
    this.el.addEventListener('model-loaded', () => {
      this.initSoundControl();
      this.initScene();
      this.initStartButton();

      // Cached high score
      let hs = localStorage.getItem('highscore');
      highScore = hs? parseInt(hs): 0;
      document.querySelector('#highscore').setAttribute('text', {
        'value': highScore
      });
      updatePowerupHud();
    });
  },
  initLife: function () {
    lifeCnt = 3;
    renderLife(lifeCnt);
  },
  initSoundControl: function () {
    let soundEl = document.getElementById('sound');
    soundEl.addEventListener('click', () => {
      soundCtrl = !soundCtrl;
      let off = 'fa-volume-off';
      let on = 'fa-volume-up';
      soundEl.className = soundEl.className.replace(soundCtrl ? off : on, soundCtrl ? on : off);
      ready.mute(!soundCtrl);
      siren.mute(!soundCtrl);
      ghostEaten.mute(!soundCtrl);
      waza.mute(!soundCtrl);
      eating.mute(!soundCtrl);
      eatGhost.mute(!soundCtrl);
      eatPill.mute(!soundCtrl);
      die.mute(!soundCtrl);
    });
  },
  initScene: function () {
    // Set opacity of the wall
    setOpacity(this.el, 0.75);

    let sceneEl = this.el.sceneEl;
    let cnt = 0;
    let line = [];
    
    sceneEl.addEventListener('enter-vr', () => {
      document.getElementById('sound').style.display = 'none';
      document.getElementById('github').style.display = 'none';
      let button = document.getElementById("start");
      if (button.innerHTML.indexOf('START') > -1 && button.style.display !== 'none') {
        button.style.display = 'none';
        this.start();
      }
    });
    sceneEl.addEventListener('exit-vr', () => {
      document.getElementById('sound').style.display = 'block';
      document.getElementById('github').style.display = 'block';
    });

    // Create pellets and power pills
    for (let i = 0; i < maze.length; i++) {
      let x = startX + i %  col * step; 
      let z = startZ + Math.floor(i / col) * step;
      const cellType = maze[i] >= P.POWERPILL ? getPowerPillType(i) : maze[i];
      if (maze[i] >= P.PELLET) {
        pCnt++;

        let sphere = document.createElement('a-sphere');
        sphere.setAttribute('color', cellType >= P.POWERPILL ? getPowerPillColor(cellType) : pColor);
        sphere.setAttribute('radius', cellType >= P.POWERPILL ? radius * 2 : radius);
        sphere.setAttribute('position', `${x} ${y} ${z}`);
        sphere.setAttribute('id', `p${i}`);
        sphere.setAttribute('pellet', '');
        
        if (cellType >= P.POWERPILL) {
          let animation = document.createElement('a-animation');
          animation.setAttribute("attribute", "material.color");
          animation.setAttribute("from", getPowerPillColor(cellType));
          animation.setAttribute("to", "white");
          animation.setAttribute("dur","500");
          animation.setAttribute("repeat","indefinite");
          sphere.appendChild(animation);
        }
        sceneEl.appendChild(sphere);
      }
      
      // Store positions in path
      line.push(maze[i] >= 0 ? [x, y, z, cellType > 0 ? i : P.WALL, cellType] : []); 
      cnt++;    
      if (cnt > (col - 1)) {
        path.push(line);
        line = [];
        cnt = 0;
      }
    }
    totalP = pCnt;
    stageTargetScore = getHalfPelletScoreTarget();
    initMinimap();
  },
  initStartButton: function () {
    let button = document.getElementById("start");
    if (button) {
      button.addEventListener('click', this.start.bind(this));
      button.innerHTML = "START";
      button.disabled = false;
    }
  },
  start: function () {
    this.initLife();

    document.querySelectorAll('[pellet]')
      .forEach(p => p.setAttribute('visible', true));
    pCnt = totalP;

    document.getElementById("logo").style.display = 'none';
    document.getElementById("start").style.display = 'none';
    document.getElementById("gameover").style.display = 'none';
    document.getElementById("ready").style.display = 'block';

    score = 0;
    stageLevel = 1;
    ghostDefeatedCnt = 0;
    stageScoreStart = 0;
    stageTransitioning = false;
    activePowerType = null;
    document.querySelector('#score').setAttribute('text', {
      'value': score
    });
    updateGhostDefeatedHud();
    updatePowerupHud();

    ready.play();
    restart(3000);
  }
});

AFRAME.registerComponent('player', {
  init: function () {
    this.waveCnt = 0;
    this.hitGhosts = [];
    this.ghosts = document.querySelectorAll('[ghost]');
    this.player = document.querySelector('[player]');
    this.camera = document.querySelector('a-camera');
    this.baseMoveSpeed = 1.35;
    this.moveTarget = null;
    // Keep player orientation independent from pathfinding turning.
    this.player.setAttribute('nav-agent', { active: false });
    this.lastNearestGhostDist = null;
    this.lastNearbyGhostCnt = -1;
    this.currentBg = siren;
    this.nextBg = siren;
  },
  tick: function (time, timeDelta) {
    if (dead || path.length < row) return;

    this.nextBg = siren;
    const currentPos = this.player.object3D.position;
    const position = {x: currentPos.x, y: currentPos.y, z: currentPos.z};
    const x = position.x;
    const yPos = position.y;
    const z = position.z;

    this.updatePlayerMovement(x, yPos, z, timeDelta);
    this.updateCloseProximity(x, z);
    this.onCollideWithPellets(x, z);
    this.updateGhosts(x, z);
    this.updateMode(position, timeDelta);
    this.checkStageAdvance();
    renderMinimap(position, this.ghosts);

    document.querySelector('#score').setAttribute('text', { value: score });
    updateHighScoreLive();
    updatePowerupHud();

    if (this.nextBg && this.currentBg !== this.nextBg) {
      this.currentBg.stop();
      this.nextBg.play();
      this.currentBg = this.nextBg;
    }
  },
  updatePlayerMovement: function (x, y, z, timeDelta) {
    if (!this.moveTarget) {
      this.moveTarget = new THREE.Vector3(x, y, z);
    }

    const currentPos = this.player.object3D.position;
    const dx = this.moveTarget.x - currentPos.x;
    const dz = this.moveTarget.z - currentPos.z;
    const distToTarget = Math.sqrt(dx * dx + dz * dz);

    if (distToTarget < 0.04) {
      this.updatePlayerDest(currentPos.x, currentPos.y, currentPos.z);
    }

    const speedMul = activePowerType === P.POWER_SPEED ? 2 : 1;
    const moveStep = this.baseMoveSpeed * speedMul * (timeDelta / 1000);
    const ndx = this.moveTarget.x - currentPos.x;
    const ndz = this.moveTarget.z - currentPos.z;
    const remaining = Math.sqrt(ndx * ndx + ndz * ndz);
    if (remaining < 0.0001) return;

    if (moveStep >= remaining) {
      currentPos.set(this.moveTarget.x, currentPos.y, this.moveTarget.z);
      return;
    }

    currentPos.x += (ndx / remaining) * moveStep;
    currentPos.z += (ndz / remaining) * moveStep;
  },
  getForwardStep: function () {
    const forward = new THREE.Vector3();
    this.camera.object3D.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() === 0) return null;
    forward.normalize();
    forward.multiplyScalar(-1);

    // Restrict to dominant axis for deterministic tile movement.
    if (Math.abs(forward.x) > Math.abs(forward.z)) {
      return {x: Math.sign(forward.x), z: 0};
    }
    return {x: 0, z: Math.sign(forward.z)};
  },
  clampGrid: function (i, j) {
    return {
      i: i > row - 1 ? row - 1 : i < 0 ? 0 : i,
      j: j > col - 1 ? col - 1 : j < 0 ? 0 : j
    };
  },
  updatePlayerDest: function (x, y, z) {
    const forwardStep = this.getForwardStep();
    if (!forwardStep) return;
    const targetX = x + forwardStep.x * step;
    const targetZ = z + forwardStep.z * step;
    const z_ = Math.round((targetZ - startZ) / step);
    const x_ = Math.round((targetX - startX) / step);
    const clamped = this.clampGrid(z_, x_);
    const i = clamped.i;
    const j = clamped.j;

    if (i === 13 && j === 0) // Tunnel
      this.moveTarget = new THREE.Vector3(path[13][24][0], y, path[13][24][2]);
    else if (i === 13 && j === 25)
      this.moveTarget = new THREE.Vector3(path[13][1][0], y, path[13][1][2]);
    else {
      let newPos = path[i][j];
      if (newPos && newPos.length > 0)
        this.moveTarget = new THREE.Vector3(newPos[0], y, newPos[2]);
    }
  },
  updateCloseProximity: function (x, z) {
    let nearest = Infinity;
    let nearbyCnt = 0;
    this.ghosts.forEach(ghost => {
      const ghostPos = ghost.getAttribute('position');
      const dx = ghostPos.x - x;
      const dz = ghostPos.z - z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < nearest) nearest = dist;
      if (dist <= closeProximityDist) nearbyCnt++;
    });

    const nearestRounded = Number.isFinite(nearest) ? Number(nearest.toFixed(3)) : -1;
    if (nearestRounded !== this.lastNearestGhostDist || nearbyCnt !== this.lastNearbyGhostCnt) {
      this.lastNearestGhostDist = nearestRounded;
      this.lastNearbyGhostCnt = nearbyCnt;
      this.player.setAttribute('data-nearest-ghost-distance', nearestRounded);
      this.player.setAttribute('data-nearby-ghost-count', nearbyCnt);
      this.player.emit('proximity-update', {
        nearestGhostDistance: nearestRounded,
        nearbyGhostCount: nearbyCnt
      });
    }
  },
  updateGhosts: function (x, z) {
    const ghosts = this.ghosts;
    for (var i = 0; i < ghosts.length; i++) {
      if (ghosts[i].dead) this.nextBg = ghostEaten;
      const ghostPos = ghosts[i].getAttribute('position');
      const dx = x - ghostPos.x;
      const dz = z - ghostPos.z;
      const inChaseRange = Math.sqrt(dx * dx + dz * dz) <= ghostChaseRadius;
      if (inChaseRange && !dead && activePowerType !== P.POWER_FREEZE && !ghosts[i].dead) {
        updateAgentDest(ghosts[i], new THREE.Vector3(x, 0, z));
      }

      this.onCollideWithGhost(ghosts[i], x, z, i);

      if (activePowerType === P.POWER_KILL && ghosts[i].slow) {
        if (pillCnt > 0) {
          if (pillCnt < flashDurationMs && Math.floor(pillCnt / 150) % 2 === 0) // Flash
            updateGhostColor(ghosts[i].object3D, 0xFFFFFF);
          else
            updateGhostColor(ghosts[i].object3D, gColor);
        }
      }
    }
  },
  updateMode: function (position, timeDelta) {
    targetPos = null;
    if (pillCnt > 0) {
      pillCnt = Math.max(0, pillCnt - timeDelta);
      if (activePowerType === P.POWER_KILL && this.nextBg != ghostEaten) this.nextBg = waza;
      if (pillCnt === 0) this.clearPowerEffect();
    } else {
      // Scatter and chase
      this.waveCnt = this.waveCnt > (chaseDuration + scatterDuration) ? 0 : this.waveCnt + 1;
      if (this.waveCnt > scatterDuration) 
        targetPos = position;
    }
  },
  checkStageAdvance: function () {
    if (stageTransitioning || dead) return;
    const stageScoreDelta = score - stageScoreStart;
    if (ghostDefeatedCnt >= 4 || stageScoreDelta >= stageTargetScore) {
      this.advanceStage();
    }
  },
  advanceStage: function () {
    stageTransitioning = true;
    stageLevel++;
    ghostDefeatedCnt = 0;
    stageScoreStart = score;

    this.stop();
    pCnt = totalP;
    document.querySelectorAll('[pellet]').forEach(p => p.setAttribute('visible', true));
    updateGhostDefeatedHud();

    document.getElementById("gameover").style.display = 'none';
    const readyEl = document.getElementById("ready");
    readyEl.innerHTML = `STAGE ${stageLevel}`;
    readyEl.style.display = 'block';

    setTimeout(() => {
      readyEl.innerHTML = 'READY!';
      stageTransitioning = false;
      restart(1600);
    }, 1000);
  },
  onGameOver: function (win) {
    this.nextBg = undefined;
    siren.stop();
    waza.stop();
    ghostEaten.stop();
    
    this.el.sceneEl.exitVR();

    let gameoverEl = document.getElementById("gameover");
    gameoverEl.innerHTML = win ? 'YOU WIN' : 'GAME OVER';
    if (win) 
      gameoverEl.classList.add("blink");
    else
      gameoverEl.classList.remove("blink");
    gameoverEl.style.display = 'block';

    let startEl = document.getElementById("start");
    startEl.innerHTML = 'RESTART';
    startEl.style.display = 'block';
  },
  onCollideWithGhost: function (ghost, x, z, i) {
    const ghostX = ghost.getAttribute('position').x;
    const ghostZ = ghost.getAttribute('position').z;

    if (Math.abs(ghostX - x) < gCollideDist && Math.abs(ghostZ - z) < gCollideDist) {
      if (!ghost.dead){
        if (ghost.slow) {
          eatGhost.play();

          this.hitGhosts.push(i);
          ghostDefeatedCnt++;
          updateGhostDefeatedHud();
          ghost.dead = true;
          ghost.slow = false;

          // Move to ghost house
          ghost.setAttribute('nav-agent', {
            active: false,
            speed: gFastSpeed,
          });
          updateAgentDest(ghost, ghost.defaultPos);

          setOpacity(ghost, 0.3);
          score += ghostScore * this.hitGhosts.length;
        } else {
          this.onDie();
          return;
        }
      }
    }
  },
  onCollideWithPellets: function (x, z) {
    const i = Math.round((z - startZ)/step);
    const j = Math.round((x - startX)/step);
    const clamped = this.clampGrid(i, j);
    const currentP = path[clamped.i][clamped.j];

    if (currentP && currentP[4] >= P.PELLET) {
      let pellet = document.querySelector(`#p${currentP[3]}`);
      if (pellet && pellet.getAttribute('visible')) {
        pCnt--;
        pellet.setAttribute('visible', false);

        // Power pill
        if (currentP[4] >= P.POWERPILL) {
          eatPill.play();
          score += pillScore;
          this.onEatPill(currentP[4]);
        } else {
          eating.play();
          score += pelletScore;
        }
      }
      if (pCnt < 1) this.onWin();
    }
  },
  onEatPill: function (powerType) {
    pillCnt = getPowerPillDuration(powerType);
    this.clearPowerEffect();
    activePowerType = powerType;
    updatePowerupHud();

    if (powerType === P.POWER_KILL) {
      this.hitGhosts = [];
      this.ghosts.forEach(ghost => {
        updateGhostColor(ghost.object3D, gColor);
        ghost.slow = true;
        ghost.setAttribute('nav-agent', {
          active: true,
          speed: gSlowSpeed
        });
      });
      return;
    }

    if (powerType === P.POWER_FREEZE) {
      this.ghosts.forEach(ghost => {
        ghost.slow = false;
        updateGhostColor(ghost.object3D, 0x7DE7FF);
        ghost.setAttribute('nav-agent', {
          active: false
        });
      });
      return;
    }

    if (powerType === P.POWER_SPEED) {
      this.player.setAttribute('data-speed-boost', 'true');
    }
  },
  clearPowerEffect: function () {
    if (activePowerType === P.POWER_SPEED) {
      this.player.setAttribute('data-speed-boost', 'false');
    }

    this.ghosts.forEach(ghost => {
      ghost.slow = false;
      if (!ghost.dead) {
        updateGhostColor(ghost.object3D, ghost.defaultColor);
        ghost.setAttribute('nav-agent', {
          active: true,
          speed: gNormSpeed
        });
      }
    });
    activePowerType = null;
    updatePowerupHud();
  },
  onWin: function () {
    this.stop();
    this.onGameOver(true);
  },
  onDie: function () {
    die.play();

    this.stop();
    updateLife();

    // Rotate replayer
    let player = this.player;
    player.setAttribute('nav-agent', {
      active: false
    });
    let animation = document.createElement('a-animation');
    animation.setAttribute("attribute","rotation");
    animation.setAttribute("to", "0 720 0");
    animation.setAttribute("dur","2000");
    animation.setAttribute("easing", "linear");
    animation.setAttribute("repeat","0");
    player.appendChild(animation);

    setTimeout(() => {
      // Restart
      if(lifeCnt > 0) {
        player.removeChild(animation);
        restart(1500);
      } else 
        this.onGameOver(false);
    }, 1000);
  },
  stop: function () {
    disableCamera();
    dead = true;
    pillCnt = 0;
    this.waveCnt = 0;
    this.moveTarget = null;
    this.clearPowerEffect();

    // Update score
    updateHighScoreLive();

    // Stop ghosts
    this.ghosts.forEach(ghost => {
      ghost.setAttribute('nav-agent', {
        active: false,
        speed: gNormSpeed
      });
    });

    // Move ghosts to ghost house
    this.ghosts.forEach(ghost => {
      ghost.dead = false;
      ghost.slow = false;
      updateGhostColor(ghost.object3D, ghost.defaultColor);
      setOpacity(ghost, 1);
      ghost.object3D.position.set(ghost.defaultPos.x, ghost.defaultPos.y, ghost.defaultPos.z);
    });
  }
});

AFRAME.registerComponent('ghost', {
  schema: {type: 'string'}, 
  init: function () {
    let el = this.el;
    let pos = el.getAttribute('position');
    el.defaultPos = new THREE.Vector3(pos.x, pos.y, pos.z);
    el.defaultColor = this.data;
    el.addEventListener('model-loaded', () => updateGhostColor(el.object3D, el.defaultColor));
    el.addEventListener('navigation-end', this.onNavEnd.bind(this));
  },
  onNavEnd: function () {
    let el = this.el;
    if (el.dead) {
      el.dead = false;
      el.slow = false;
      setOpacity(el, 1);
      updateGhostColor(el.object3D, el.defaultColor);
      el.setAttribute('nav-agent', {
        speed: gNormSpeed
      });
    }
    const player = document.querySelector('[player]');
    const playerPos = player.getAttribute('position');
    const ghostPos = el.getAttribute('position');
    const dx = playerPos.x - ghostPos.x;
    const dz = playerPos.z - ghostPos.z;
    const playerInChaseRange = Math.sqrt(dx * dx + dz * dz) <= ghostChaseRadius;
    if (playerInChaseRange && !dead && activePowerType !== P.POWER_FREEZE) {
      updateAgentDest(el, new THREE.Vector3(playerPos.x, 0, playerPos.z));
      return;
    }

    let p = Math.floor(Math.random() * intersections.length);
    let x = startX + intersections[p][0] * step; 
    let z = startZ + intersections[p][1] * step; 
    updateAgentDest(el, targetPos ? targetPos : new THREE.Vector3(x, 0, z));
  }
}); 

function setOpacity(object, opacity) {
  const mesh = object.getObject3D('mesh');
  if (!mesh) return;
  mesh.traverse(node => {
    if (node.isMesh) {
      node.material.opacity = opacity;
      node.material.transparent = opacity < 1.0;
      node.material.needsUpdate = true;
    }
  });
}

function updateAgentDest(object, dest) {
  object.setAttribute('nav-agent', {
    active: true,
    destination: dest
  });
}

function updateGhostColor(ghost, color) {
  ghost.traverse(child => {
    if (child instanceof THREE.Mesh && child.material.name === 'ghostmat')
      child.material.color.setHex(color);
  });
}

function updateHighScoreLive() {
  if (score < highScore) return;
  if (score !== highScore) {
    highScore = score;
    localStorage.setItem('highscore', highScore);
  }
  document.querySelector('#highscore').setAttribute('text', {
    value: highScore
  });
}

function getPowerupName(powerType) {
  if (powerType === P.POWER_SPEED) return 'SPEED';
  if (powerType === P.POWER_KILL) return 'KILL';
  if (powerType === P.POWER_FREEZE) return 'FREEZE';
  return 'NONE';
}

function updatePowerupHud() {
  const powerupEl = document.querySelector('#powerup');
  if (!powerupEl) return;
  powerupEl.setAttribute('text', {
    value: `POWER: ${getPowerupName(activePowerType)}`,
    color: getPowerPillColor(activePowerType)
  });
}

function updateGhostDefeatedHud() {
  const ghostCntEl = document.querySelector('#ghostcount');
  if (!ghostCntEl) return;
  ghostCntEl.setAttribute('text', {
    value: `GHOSTS: ${ghostDefeatedCnt}/4`
  });
}

function worldToTile(x, z) {
  const tileX = Math.round((x - startX) / step);
  const tileZ = Math.round((z - startZ) / step);
  return {
    x: tileX > col - 1 ? col - 1 : tileX < 0 ? 0 : tileX,
    z: tileZ > row - 1 ? row - 1 : tileZ < 0 ? 0 : tileZ
  };
}

function initMinimap() {
  minimapCanvas = document.getElementById('minimap');
  if (!minimapCanvas) return;
  minimapCtx = minimapCanvas.getContext('2d');
}

function renderMinimap(playerPos, ghosts) {
  if (!minimapCanvas || !minimapCtx) return;

  const ctx = minimapCtx;
  const w = minimapCanvas.width;
  const h = minimapCanvas.height;
  const tileW = w / col;
  const tileH = h / row;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < maze.length; i++) {
    const tx = i % col;
    const tz = Math.floor(i / col);
    const px = tx * tileW;
    const pz = tz * tileH;

    if (maze[i] < 0) {
      ctx.fillStyle = '#142A66';
      ctx.fillRect(px, pz, tileW, tileH);
      continue;
    }

    if (maze[i] >= P.PELLET) {
      const pellet = document.querySelector(`#p${i}`);
      if (pellet && pellet.getAttribute('visible')) {
        const pelletType = getPowerPillType(i);
        ctx.fillStyle = maze[i] >= P.POWERPILL ? getPowerPillColor(pelletType) : pColor;
        const r = maze[i] >= P.POWERPILL ? Math.max(2, tileW * 0.28) : Math.max(1, tileW * 0.16);
        ctx.beginPath();
        ctx.arc(px + tileW / 2, pz + tileH / 2, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  const playerTile = worldToTile(playerPos.x, playerPos.z);
  ctx.fillStyle = '#FFE600';
  ctx.beginPath();
  ctx.arc((playerTile.x + 0.5) * tileW, (playerTile.z + 0.5) * tileH, Math.max(2, tileW * 0.35), 0, Math.PI * 2);
  ctx.fill();

  ghosts.forEach(ghost => {
    if (ghost.dead) return;
    const ghostPos = ghost.getAttribute('position');
    const ghostTile = worldToTile(ghostPos.x, ghostPos.z);
    ctx.fillStyle = '#FF4D4D';
    ctx.fillRect((ghostTile.x + 0.2) * tileW, (ghostTile.z + 0.2) * tileH, tileW * 0.6, tileH * 0.6);
  });
}

function getPowerPillType(cellIndex) {
  const types = [P.POWER_SPEED, P.POWER_KILL, P.POWER_FREEZE];
  return types[cellIndex % types.length];
}

function getPowerPillColor(powerType) {
  if (!powerType) return '#FFFFFF';
  if (powerType === P.POWER_SPEED) return '#FFD54A';
  if (powerType === P.POWER_FREEZE) return '#6EE7FF';
  return '#5B7BFF';
}

function getPowerPillDuration(powerType) {
  if (powerType === P.POWER_SPEED) return powerDuration.speed;
  if (powerType === P.POWER_FREEZE) return powerDuration.freeze;
  return powerDuration.kill;
}

function getHalfPelletScoreTarget() {
  let totalScore = 0;
  for (let i = 0; i < maze.length; i++) {
    if (maze[i] < P.PELLET) continue;
    totalScore += maze[i] >= P.POWERPILL ? pillScore : pelletScore;
  }
  return Math.floor(totalScore / 2);
}

function movePlayerToDefaultPosition() {
  const player = document.querySelector('[player]');
  player.object3D.position.set(0, 0, 4);
  player.object3D.rotation.set(0, 0, 0);
}

function disableCamera() {
  const camera = document.querySelector("a-camera");
  camera.removeAttribute('look-controls');
  camera.setAttribute('look-controls', {
    'enabled': false
  });
}

function enableCamera() {
  const camera = document.querySelector("a-camera");
  camera.removeAttribute('look-controls');
  camera.setAttribute('look-controls', {
    'pointerLockEnabled': true
  });
}

function updateLife() {  
  if (lifeCnt > 0) {
    lifeCnt--;
    renderLife(lifeCnt);
  }
}

function renderLife(cnt) {
  let lifeEls = document.querySelectorAll("[life]");
  for (let i = 0; i < cnt; i++) {
    lifeEls[i].setAttribute('visible', true);
  }
  for (let i = lifeEls.length - 1; i >= cnt; i--) {
    lifeEls[i].setAttribute('visible', false);
  }
}

function restart(timeout) {
  movePlayerToDefaultPosition();
  setTimeout(() => {
    document.getElementById("ready").style.display = 'none';
    document.querySelectorAll('[ghost]')
      .forEach(ghost => updateAgentDest(ghost, ghost.defaultPos));
    dead = false;
    enableCamera();
  }, timeout);    
}
