import * as THREE from '../vendor/three.module.js';

// Self-contained bloom + grade pipeline (no addon deps). Renders the scene to an HDR
// target, extracts bright neon, blurs it wide, then composites with ACES tone-mapping,
// a touch of saturation and a vignette. This is what turns the flat neon into glow.
const VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const BRIGHT = /* glsl */`
  precision highp float;
  uniform sampler2D tDiffuse; uniform float threshold; uniform float softKnee;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb;
    float l = max(c.r, max(c.g, c.b));
    float knee = threshold * softKnee + 1e-5;
    float soft = clamp((l - threshold + knee) / (2.0 * knee), 0.0, 1.0);
    float w = max(soft * soft, max(0.0, l - threshold)) / max(l, 1e-4);
    gl_FragColor = vec4(c * w, 1.0);
  }
`;

const BLUR = /* glsl */`
  precision highp float;
  uniform sampler2D tDiffuse; uniform vec2 dir;
  varying vec2 vUv;
  void main() {
    // 9-tap gaussian
    vec3 s = texture2D(tDiffuse, vUv).rgb * 0.227027;
    s += texture2D(tDiffuse, vUv + dir * 1.3846).rgb * 0.316216;
    s += texture2D(tDiffuse, vUv - dir * 1.3846).rgb * 0.316216;
    s += texture2D(tDiffuse, vUv + dir * 3.2308).rgb * 0.070270;
    s += texture2D(tDiffuse, vUv - dir * 3.2308).rgb * 0.070270;
    gl_FragColor = vec4(s, 1.0);
  }
`;

const COMPOSITE = /* glsl */`
  precision highp float;
  uniform sampler2D tScene; uniform sampler2D tBloom;
  uniform float strength; uniform float time; uniform vec2 res;
  varying vec2 vUv;
  vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
  vec3 lin2srgb(vec3 c){ return mix(1.055*pow(c,vec3(1.0/2.4))-0.055, c*12.92, step(c,vec3(0.0031308))); }
  void main() {
    vec3 s = texture2D(tScene, vUv).rgb;
    vec3 b = texture2D(tBloom, vUv).rgb;
    vec3 c = s + b * strength;
    c = aces(c);
    // gentle saturation lift
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, 1.14);
    // vignette
    vec2 q = vUv - 0.5; q.x *= res.x / res.y;
    c *= smoothstep(1.05, 0.35, length(q)) * 0.25 + 0.75;
    // faint film grain so gradients don't band
    float g = fract(sin(dot(vUv * res + time, vec2(12.9898, 78.233))) * 43758.5453);
    c += (g - 0.5) * 0.015;
    gl_FragColor = vec4(lin2srgb(c), 1.0);
  }
`;

export class Post {
  constructor(renderer, { threshold = 0.78, strength = 0.72, iterations = 4 } = {}) {
    this.renderer = renderer;
    this.strength = strength;
    this.threshold = threshold;
    this.iterations = iterations;
    this.time = 0;

    const fsCam = new THREE.Camera();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    const fsScene = new THREE.Scene(); fsScene.add(quad);
    this.fsCam = fsCam; this.quad = quad; this.fsScene = fsScene;

    const mk = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.brightMat = mk(BRIGHT, { tDiffuse: { value: null }, threshold: { value: threshold }, softKnee: { value: 0.6 } });
    this.blurMat = mk(BLUR, { tDiffuse: { value: null }, dir: { value: new THREE.Vector2() } });
    this.compMat = mk(COMPOSITE, { tScene: { value: null }, tBloom: { value: null }, strength: { value: strength }, time: { value: 0 }, res: { value: new THREE.Vector2() } });

    this._makeTargets();
  }

  _makeTargets() {
    const r = this.renderer, size = new THREE.Vector2();
    r.getDrawingBufferSize(size);
    const W = Math.max(2, size.x | 0), H = Math.max(2, size.y | 0);
    this.W = W; this.H = H;
    const base = { type: THREE.HalfFloatType, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, depthBuffer: true };
    const disposeAll = () => { this.sceneRT?.dispose(); this.brightRT?.dispose(); this.blurA?.dispose(); this.blurB?.dispose(); };
    disposeAll();
    this.sceneRT = new THREE.WebGLRenderTarget(W, H, { ...base, samples: 4 });
    const bw = Math.max(2, (W / 2) | 0), bh = Math.max(2, (H / 2) | 0);
    this.bw = bw; this.bh = bh;
    this.brightRT = new THREE.WebGLRenderTarget(bw, bh, { ...base, depthBuffer: false });
    this.blurA = new THREE.WebGLRenderTarget(bw, bh, { ...base, depthBuffer: false });
    this.blurB = new THREE.WebGLRenderTarget(bw, bh, { ...base, depthBuffer: false });
    this.compMat.uniforms.res.value.set(W, H);
  }

  setSize() { this._makeTargets(); }

  _pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.fsScene, this.fsCam);
  }

  render(scene, camera, dt = 0) {
    const r = this.renderer;
    this.time += dt;
    // 1. scene → HDR target
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);
    // 2. bright pass (downsampled)
    this.brightMat.uniforms.tDiffuse.value = this.sceneRT.texture;
    this._pass(this.brightMat, this.brightRT);
    // 3. separable gaussian, ping-pong, widening
    let src = this.brightRT;
    for (let i = 0; i < this.iterations; i++) {
      this.blurMat.uniforms.tDiffuse.value = src.texture;
      this.blurMat.uniforms.dir.value.set(1 / this.bw, 0);
      this._pass(this.blurMat, this.blurA);
      this.blurMat.uniforms.tDiffuse.value = this.blurA.texture;
      this.blurMat.uniforms.dir.value.set(0, 1 / this.bh);
      this._pass(this.blurMat, this.blurB);
      src = this.blurB;
    }
    // 4. composite to screen
    this.compMat.uniforms.tScene.value = this.sceneRT.texture;
    this.compMat.uniforms.tBloom.value = src.texture;
    this.compMat.uniforms.time.value = this.time;
    r.setRenderTarget(null);
    this._pass(this.compMat, null);
  }
}
