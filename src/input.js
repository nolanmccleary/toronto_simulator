// Keyboard + mouse state. Mouse-look deltas only accumulate while the pointer is locked.

export class Input {
  constructor(domElement) {
    this.el = domElement;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.firing = false;    // left mouse held
    this.firing2 = false;   // right mouse held
    this.wheel = 0;         // accumulated scroll direction
    this.locked = false;
    this._onLock = null;    // optional callback(locked:boolean)

    addEventListener('keydown', (e) => {
      // Don't trap browser shortcuts (Cmd/Ctrl combos) or typing in a text field.
      if (e.metaKey || e.ctrlKey) return;
      if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));

    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });

    addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this.firing2 = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.firing2 = false;
    });
    addEventListener('contextmenu', (e) => { if (this.locked) e.preventDefault(); });
    addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) { this.firing = false; this.firing2 = false; this.keys.clear(); }
      if (this._onLock) this._onLock(this.locked);
    });
  }

  onLockChange(fn) { this._onLock = fn; }

  // Returns -1/0/1 scroll direction since last call, then resets.
  consumeWheel() { const w = this.wheel; this.wheel = 0; return w ? Math.sign(w) : 0; }

  requestLock() {
    const p = this.el.requestPointerLock?.();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(code) { return this.keys.has(code); }

  // Returns {x,y} look delta since last call, then resets the accumulator.
  consumeLook() {
    const d = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0; this.mouseDY = 0;
    return d;
  }

  // Normalized movement intent in local space: x = strafe (right+), z = forward(+).
  moveAxis() {
    let x = 0, z = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) z += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) z -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    return { x, z };
  }
}
