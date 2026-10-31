/*!
 * Three-layer fluid background shader.
 *
 * Layer stack: 32px (base color mass), 64px (main flow), 128px (detail).
 * The slow large-scale motion runs in the vertex grid as curl noise; the
 * fragment only samples the pre-blurred layers, grades them and composites.
 */

export const quadVertex = `
  attribute vec2 a_uv;
  varying vec2 v_uv;
  void main() {
    gl_Position = vec4(a_uv * 2.0 - 1.0, 0.0, 1.0);
    v_uv = a_uv;
  }
`

export const blurFragment = `
  precision highp float;
  uniform sampler2D u_texture;
  uniform float u_offset;
  uniform vec2 u_sourceSize;
  varying vec2 v_uv;
  void main() {
    vec2 offset = vec2(u_offset) / u_sourceSize;
    gl_FragColor = (
      texture2D(u_texture, v_uv + vec2(-offset.x, -offset.y)) +
      texture2D(u_texture, v_uv + vec2(offset.x, -offset.y)) +
      texture2D(u_texture, v_uv + vec2(-offset.x, offset.y)) +
      texture2D(u_texture, v_uv + offset)
    ) * 0.25;
  }
`

export const flowVertex = `
  precision highp float;
  attribute vec2 a_uv;
  uniform float u_time;
  uniform float u_mix;
  varying vec2 v_uv;
  varying vec2 v_warp0;
  varying vec2 v_warp1;
  varying vec2 v_warp2;

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m; m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  // Divergence-free flow gives the slow silk-like drift instead of a per-pixel
  // wobble. The grid evaluates it per vertex, so cost is independent of output
  // resolution.
  vec2 curl(vec2 p) {
    const float e = 0.003;
    float up = snoise(p + vec2(0.0, e));
    float down = snoise(p - vec2(0.0, e));
    float right = snoise(p + vec2(e, 0.0));
    float left = snoise(p - vec2(e, 0.0));
    return vec2((up - down) / (2.0 * e), -(right - left) / (2.0 * e));
  }

  vec2 warp(vec2 uv, float frequency, float speed, float phase, float amplitude) {
    vec2 p = uv * frequency + vec2(phase, phase * 0.71) + vec2(u_time * speed, -u_time * speed * 0.73);
    float weight = smoothstep(0.92, 0.18, length(uv - 0.5));
    return uv + curl(p) * amplitude * weight;
  }

  void main() {
    gl_Position = vec4(a_uv * 2.0 - 1.0, 0.0, 1.0);
    v_uv = a_uv;
    // Large blobs move least, the detail layer flows a little faster.
    v_warp0 = warp(a_uv, 0.85, 0.070, 0.0, 0.024);
    v_warp1 = warp(a_uv, 1.45, 0.105, 17.0, 0.017);
    v_warp2 = warp(a_uv, 2.35, 0.150, 41.0, 0.009);
  }
`

export const flowFragment = `
  precision highp float;
  uniform sampler2D u_to0;
  uniform sampler2D u_to1;
  uniform sampler2D u_to2;
  uniform sampler2D u_from0;
  uniform sampler2D u_from1;
  uniform sampler2D u_from2;
  uniform float u_mix;
  uniform float u_time;
  uniform vec2 u_resolution;
  uniform vec4 u_shade;
  varying vec2 v_uv;
  varying vec2 v_warp0;
  varying vec2 v_warp1;
  varying vec2 v_warp2;

  vec3 softLight(vec3 base, vec3 blend) {
    vec3 low = 2.0 * base * blend + base * base * (1.0 - 2.0 * blend);
    vec3 high = sqrt(max(base, 0.0)) * (2.0 * blend - 1.0) + 2.0 * base * (1.0 - blend);
    return mix(low, high, step(vec3(0.5), blend));
  }

  vec3 srgbToLinear(vec3 color) {
    return mix(color / 12.92, pow((color + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), color));
  }

  vec3 linearToSrgb(vec3 color) {
    return mix(color * 12.92, 1.055 * pow(max(color, 0.0), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), color));
  }

  vec3 oklabFromLinear(vec3 color) {
    vec3 lms = vec3(
      dot(color, vec3(0.4122214708, 0.5363325363, 0.0514459929)),
      dot(color, vec3(0.2119034982, 0.6806995451, 0.1073969566)),
      dot(color, vec3(0.0883024619, 0.2817188376, 0.6299787005))
    );
    lms = pow(max(lms, 0.0), vec3(1.0 / 3.0));
    return vec3(
      dot(lms, vec3(0.2104542553, 0.7936177850, -0.0040720468)),
      dot(lms, vec3(1.9779984951, -2.4285922050, 0.4505937099)),
      dot(lms, vec3(0.0259040371, 0.7827717662, -0.8086757660))
    );
  }

  vec3 linearFromOklab(vec3 lab) {
    vec3 lms = vec3(
      lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z,
      lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z,
      lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z
    );
    lms = lms * lms * lms;
    return vec3(
      dot(lms, vec3(4.0767416621, -3.3077115913, 0.2309699292)),
      dot(lms, vec3(-1.2684380046, 2.6097574011, -0.3413193965)),
      dot(lms, vec3(-0.0041960863, -0.7034186147, 1.7076147010))
    );
  }

  vec3 grade(vec3 color) {
    vec3 lab = oklabFromLinear(srgbToLinear(clamp(color, 0.0, 1.0)));
    // Keep the artwork's hue and make its colorful areas richer; the blurred
    // stack otherwise converges toward a flat gray.
    lab.y *= 1.22;
    lab.z *= 1.22;
    lab.x = clamp((lab.x - 0.5) * 1.05 + 0.5, 0.0, 1.0);
    return clamp(linearToSrgb(clamp(linearFromOklab(lab), 0.0, 1.0)), 0.0, 1.0);
  }

  vec3 sampleLayer(sampler2D from, sampler2D to, vec2 uv) {
    // The outgoing cover drifts along the flow while it fades out.
    vec2 outgoing = clamp(uv + vec2(0.018, -0.011) * (1.0 - u_mix), 0.0, 1.0);
    return mix(texture2D(from, outgoing).rgb, texture2D(to, clamp(uv, 0.0, 1.0)).rgb, u_mix);
  }

  float hash(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec3 base = sampleLayer(u_from0, u_to0, v_warp0);
    vec3 mid = sampleLayer(u_from1, u_to1, v_warp1);
    vec3 detail = sampleLayer(u_from2, u_to2, v_warp2);

    vec3 color = mix(base, mid, 0.5);
    color = mix(color, softLight(color, detail), 0.22);
    color = grade(color);
    color *= 0.94;

    // Keep the edges readable and the center slightly deeper, without a visible
    // black ring on bright artwork.
    vec2 center = v_uv - 0.5;
    color *= 1.0 - dot(center, center) * 0.26;

    // Theme surface gradient: fold it into this pass instead of allocating a
    // second full-window layer.
    float shade = clamp((v_uv.x - 0.12) / 1.03, 0.0, 1.0) * u_shade.a;
    color = mix(clamp(color, 0.0, 1.0), u_shade.rgb, shade);

    // Static 8-bit output bands on very soft gradients; a tiny animated dither
    // is cheaper than a higher-precision drawing buffer.
    float noise = hash(vec3(floor(v_uv * u_resolution), floor(u_time * 60.0)));
    color += (noise - 0.5) * 0.006;

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`
