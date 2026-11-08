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
    this.powerWrap = this.$('power-wrap');
    this.powerLabel = this.$('power-label');
    this.powerFill = this.$('power-fill');
    this.fuelWrap = this.$('fuel-wrap');
    this.fuelFill = this.$('fuel-fill');
    this.somaliText = this.$('somali-text');
    this.prompt = this.$('prompt');
    this.consoleEl = this.$('console');
    this.consoleInput = this.$('console-input');
    this.hpPct = this.$('hp-pct');
    this.compass = this.$('compass');
    this.compassTape = this.$('compass-tape');
    this.compassHdg = this.$('compass-hdg');
    this._pool = [];
    this._weapon = 'strap';
    this._bannerTimer = 0;
    this._buildCompass();
  }

  // Pre-render a scrollable heading tape (−360°…+720° so it never runs out as it wraps).
  _buildCompass() {
    this._pxPerDeg = 2.4;
    this._compassW = 264;
    if (!this.compassTape) return;
    const card = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    let html = '';
    for (let d = -360; d <= 720; d += 15) {
      const x = (d + 360) * this._pxPerDeg;
      const dd = ((d % 360) + 360) % 360;
      const major = dd % 90 === 0;
      const label = card[dd];
      const inner = label ? `<b class="${major ? 'card' : ''}">${label}</b>` : '';
      html += `<span class="ctick ${major ? 'major' : ''}" style="left:${x}px">${inner}</span>`;
    }
    this.compassTape.innerHTML = html;
    this.compassTape.style.width = (1080 * this._pxPerDeg) + 'px';
  }

  showCompass(on) { if (this.compass) this.compass.classList.toggle('on', on); }

  setCompass(yaw) {
    if (!this.compassTape) return;
    const h = (((Math.round(yaw * 180 / Math.PI)) % 360) + 360) % 360;
    this.compassHdg.textContent = String(h).padStart(3, '0');
    this.compassTape.style.transform = `translateX(${-(h + 360) * this._pxPerDeg + this._compassW / 2}px)`;
  }

  // Aux-HP + jetpack-fuel gauges during a power mode. fuelFrac < 0 = no jetpack.
  setPowerStatus(power, aux, auxMax, fuelFrac) {
    if (!power) { this.powerWrap.style.display = 'none'; this.fuelWrap.style.display = 'none'; return; }
    this.powerWrap.style.display = 'block';
    this.powerFill.style.background = ''; // fall back to the CSS gradient (civic sets a solid red)
    const inf = !isFinite(aux);
    this.powerFill.style.width = (inf ? 1 : Math.max(0, Math.min(1, aux / auxMax))) * 100 + '%';
    // Night Yute's name is already shown in the jet status line — don't repeat it here.
    const aux_s = 'AUX ' + (inf ? '∞' : Math.ceil(aux));
    this.powerLabel.textContent = power === 'somali' ? 'SOMALI SAMURAI · ' + aux_s : aux_s;
    this.fuelWrap.style.display = fuelFrac >= 0 ? 'block' : 'none';
    if (fuelFrac >= 0) this.fuelFill.style.width = Math.max(0, Math.min(1, fuelFrac)) * 100 + '%';
  }

  setPowerMode(kind) {
    // kind: null | 'somali' | 'nightyute'
    const night = kind === 'nightyute';
    this.seered.style.display = kind === 'somali' ? 'block' : 'none'; // only Somali Samurai sees red
    this.jethud.style.display = night ? 'block' : 'none';  // only Night Yute keeps the jet HUD
    this.targets.style.display = night ? 'block' : 'none';
    this.somaliText.style.display = kind === 'somali' ? 'flex' : 'none';
    if (kind) {
      this.weaponName.textContent = night ? 'XM01-NIGHT YUTE' : 'SAUGA SABRE';
      this.portalDots.style.display = 'none';
      this.crosshair.style.display = 'none';
      if (night) this.jetStatus.textContent = '● NIGHT YUTE · GAT + MISSILES';
    } else {
      this.updateTargets([]);
      this.lock.style.display = 'none';
    }
  }

  showPrompt(mode) {
    if (!mode) { this.prompt.style.display = 'none'; return; }
    this.prompt.style.display = 'block';
    const label = mode === 'somali' ? 'SOMALI SAMURAI'
      : mode === 'nightyute' ? 'XM01-NIGHT YUTE'
      : mode === 'civic' ? 'DRIVE IMPOUNDED HONDA CIVIC'
      : mode === 'civic-enter' ? 'BACK IN THE CIVIC'
      : mode;
    this.prompt.innerHTML = 'PRESS <b>E</b> — ' + label;
  }

  // Brampton Berserker driving HUD: red vignette + crosshair off + weapon label.
  setCivicMode(on) {
    this.seered.style.display = on ? 'block' : 'none';
    this.crosshair.style.display = on ? 'none' : (this._weapon === 'draco' ? 'none' : 'block');
    this.scope.style.display = 'none';
    if (on) {
      this.weaponName.textContent = 'IMPOUNDED CIVIC';
      this.portalDots.style.display = 'none';
    } else {
      this.powerWrap.style.display = 'none';
      this.fuelWrap.style.display = 'none';
    }
  }

  // The Civic's HP, shown on the aux-status bar while driving.
  setCivicHealth(hp, max) {
    this.powerWrap.style.display = 'block';
    this.fuelWrap.style.display = 'none';
    const inf = !isFinite(hp);
    this.powerFill.style.width = (inf ? 1 : Math.max(0, Math.min(1, hp / max))) * 100 + '%';
    this.powerFill.style.background = '#ff4d4d';
    this.powerLabel.textContent = 'BRAMPTON BERSERKER · CIVIC ' + (inf ? '∞' : Math.ceil(hp));
  }

  showConsole(on) {
    this.consoleEl.style.display = on ? 'flex' : 'none';
    if (on) { this.consoleInput.value = ''; setTimeout(() => this.consoleInput.focus(), 0); }
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
    if (this.hpPct) this.hpPct.textContent = Math.round(pct) + '%';
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
    const label = name === 'slider' ? 'SLIDER' : name === 'draco' ? 'DRACO' : name === 'pump' ? 'PUMP' : 'STRAP';
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
