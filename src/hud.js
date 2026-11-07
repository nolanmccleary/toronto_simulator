// Thin wrapper over the DOM overlay. Keeps all element lookups in one place.

export class HUD {
  constructor() {
    this.$ = (id) => document.getElementById(id);
    this.hp = this.$('hp-fill');
    this.hpText = this.$('hp-text');
    this.wave = this.$('wave');
    this.score = this.$('score');
    this.remaining = this.$('remaining');
    this.banner = this.$('banner');
    this.start = this.$('start');
    this.over = this.$('gameover');
    this.finalScore = this.$('final-score');
    this.finalWave = this.$('final-wave');
    this.damage = this.$('damage');
    this.crosshair = this.$('crosshair');
    this.weaponName = this.$('weapon-name');
    this.portalDots = this.$('portal-dots');
    this.portalA = this.$('portal-a');
    this.portalB = this.$('portal-b');
    this.modeTag = this.$('mode-tag');
    this.scope = this.$('scope');
    this.chargeFill = this.$('charge-fill');
    this.chargeLabel = this.$('charge-label');
    this.seered = this.$('seered');
    this.jethud = this.$('jethud');
    this.jetHdg = this.$('jet-hdg');
    this.jetSpd = this.$('jet-spd');
    this.jetAlt = this.$('jet-alt');
    this.jetStatus = this.$('jet-status');
    this.targets = this.$('targets');
    this.bossWrap = this.$('boss-wrap');
    this.bossName = this.$('boss-name');
    this.bossFill = this.$('boss-fill');
    this.lock = this.$('lock');
    this.lockFill = this.$('lock-fill');
    this.lockText = this.$('lock-text');
    this._pool = [];
    this._weapon = 'strap';
    this._bannerTimer = 0;
  }

  setCharge(frac, power) {
    this.chargeFill.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%';
    const full = frac >= 1;
    this.chargeFill.classList.toggle('full', full && !power);
    this.chargeFill.classList.toggle('power', !!power);
    if (power === 'pressa') this.chargeLabel.textContent = 'PRESSA MODE ENGAGED';
    else if (power === 'drizzy') this.chargeLabel.textContent = 'DRIZZY MODE';
    else if (full) this.chargeLabel.textContent = 'PRESSA MODE READY  —  PRESS 6';
    else this.chargeLabel.textContent = '';
  }

  setPowerMode(kind) {
    // kind: null | 'pressa' | 'drizzy'
    this.seered.style.display = kind ? 'block' : 'none';
    this.seered.classList.toggle('drizzy', kind === 'drizzy');
    this.jethud.style.display = kind ? 'block' : 'none';
    this.targets.style.display = kind ? 'block' : 'none';
    if (kind) {
      const drizzy = kind === 'drizzy';
      this.weaponName.textContent = drizzy ? 'DRIZZY ARSENAL' : 'SAUGA SABRE';
      this.portalDots.style.display = 'none';
      this.crosshair.style.display = 'none';
      this.jetStatus.textContent = drizzy ? '● DRIZZY · GATLING + MISSILES' : '● PRESSA · WPN SABRE · GUNS GUNS GUNS';
    } else {
      this.updateTargets([]);
      this.lock.style.display = 'none';
    }
  }

  setJetReadouts(hdg, spd, alt) {
    this.jetHdg.textContent = String(hdg).padStart(3, '0');
    this.jetSpd.textContent = spd;
    this.jetAlt.textContent = alt;
  }

  // Fighter-jet target boxes. entries: [{x, y (screen px), label, dist, wasted}]
  updateTargets(entries) {
    while (this._pool.length < entries.length) {
      const el = document.createElement('div');
      el.className = 'target';
      el.innerHTML = '<div class="tb"></div><span class="td"></span><span class="tl"></span>';
      this.targets.appendChild(el);
      this._pool.push({ el, dist: el.children[1], label: el.children[2] });
    }
    for (let i = 0; i < this._pool.length; i++) {
      const p = this._pool[i];
      if (i < entries.length) {
        const e = entries[i];
        p.el.style.display = 'block';
        p.el.style.transform = `translate(${e.x}px, ${e.y}px) translate(-50%, -50%)`;
        p.el.classList.toggle('wasted', !!e.wasted);
        const locking = e.lock != null;
        p.el.classList.toggle('locking', locking);
        p.label.textContent = locking ? (e.lock >= 1 ? 'FIRE' : 'LOCK ' + Math.round(e.lock * 100) + '%') : e.label;
        p.dist.textContent = e.dist != null ? e.dist + 'm' : '';
      } else {
        p.el.style.display = 'none';
      }
    }
  }

  setLock(progress, active) {
    this.lock.style.display = active ? 'block' : 'none';
    if (active) {
      this.lockFill.style.width = Math.min(1, progress) * 100 + '%';
      this.lockText.textContent = progress >= 1 ? 'LOCKED ▸ FIRE' : 'LOCKING ' + Math.round(progress * 100) + '%';
    }
  }

  setBoss(name, frac) {
    this.bossWrap.style.display = 'block';
    this.bossName.textContent = name;
    this.bossFill.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%';
  }

  hideBoss() { this.bossWrap.style.display = 'none'; }

  setHealth(hp, max) {
    const pct = Math.max(0, hp / max) * 100;
    this.hp.style.width = pct + '%';
    this.hp.style.background = pct < 30 ? '#ff5d73' : pct < 60 ? '#ffd166' : '#53f0d0';
    this.hpText.textContent = Math.ceil(hp);
  }

  setStats(wave, score, remaining) {
    this.wave.textContent = wave;
    this.score.textContent = score;
    this.remaining.textContent = remaining;
  }

  showBanner(text, seconds = 1.6) {
    this.banner.textContent = text;
    this.banner.style.opacity = '1';
    this._bannerTimer = seconds;
  }

  update(dt) {
    if (this._bannerTimer > 0) {
      this._bannerTimer -= dt;
      if (this._bannerTimer <= 0) this.banner.style.opacity = '0';
    }
  }

  flashDamage() {
    this.damage.style.transition = 'none';
    this.damage.style.opacity = '0.55';
    requestAnimationFrame(() => {
      this.damage.style.transition = 'opacity 0.4s ease-out';
      this.damage.style.opacity = '0';
    });
  }

  setWeapon(name) {
    this._weapon = name;
    const label = name === 'slider' ? 'SLIDER' : name === 'draco' ? 'DRACO' : 'STRAP';
    this.weaponName.textContent = label;
    this.crosshair.classList.toggle('portal', name === 'slider');
    this.portalDots.style.display = name === 'slider' ? 'flex' : 'none';
    // Draco has no hip-fire crosshair — you must scope.
    this.crosshair.style.display = name === 'draco' ? 'none' : 'block';
    this.scope.style.display = 'none';
  }

  setScoped(on) {
    this.scope.style.display = on ? 'block' : 'none';
    if (this._weapon === 'draco') this.crosshair.style.display = on ? 'block' : 'none';
  }

  setPortalStatus(showing, aActive, bActive) {
    if (!showing) return;
    this.portalA.classList.toggle('placed', aActive);
    this.portalB.classList.toggle('placed', bActive);
  }

  setHardcore(on) {
    this.modeTag.style.display = on ? 'block' : 'none';
  }

  showStart(show) { this.start.style.display = show ? 'flex' : 'none'; }

  setStartMode(mode) {
    const title = this.$('start-title');
    const sub = this.$('start-sub');
    if (mode === 'paused') { title.textContent = 'PAUSED'; sub.textContent = 'click to resume'; }
    else { title.textContent = 'TORONTO SIMULATOR'; sub.textContent = 'click to play'; }
  }

  showGameOver(show, score, wave) {
    this.over.style.display = show ? 'flex' : 'none';
    if (show) { this.finalScore.textContent = score; this.finalWave.textContent = wave; }
  }
}
