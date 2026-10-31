/*!
 * Adapted from @kawarp/core 1.2.1. The blur, noise, vignette and dithering
 * equations are unchanged; the slow, smooth warp now runs on a vertex grid.
 *
 * MIT License
 * Copyright (c) 2026 Better Lyrics
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
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
  varying vec2 v_uv;
  void main() {
    vec2 offset = vec2(u_offset / 128.0);
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
  varying vec2 v_uv;
  varying vec2 v_warp;

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
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
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }
  void main() {
    gl_Position = vec4(a_uv * 2.0 - 1.0, 0.0, 1.0);
    v_uv = a_uv;
    vec2 uv = (a_uv - 0.5) / 1.08 + 0.5;
    float t = u_time * 0.05;
    float weight = 1.0 - smoothstep(0.0, 0.7, length(uv - 0.5));
    float n1 = snoise(uv * 0.35 + vec2(t, t * 0.7));
    float n2 = snoise(uv * 0.35 + vec2(-t * 0.8, t * 0.5) + vec2(50.0, 50.0));
    float n3 = snoise(uv * 0.9 + vec2(t * 1.2, -t) + vec2(100.0, 0.0));
    float n4 = snoise(uv * 0.9 + vec2(-t, t * 1.1) + vec2(0.0, 100.0));
    // Interpolate before clamping, so the grid never introduces edge seams.
    v_warp = uv + vec2(n1 * 0.65 + n3 * 0.35, n2 * 0.65 + n4 * 0.35) * weight * 0.85;
  }
`

export const flowFragment = `
  precision highp float;
  uniform sampler2D u_from;
  uniform sampler2D u_to;
  uniform float u_mix;
  uniform float u_time;
  uniform vec2 u_resolution;
  uniform vec4 u_shade;
  varying vec2 v_uv;
  varying vec2 v_warp;
  float hash(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  void main() {
    vec2 uv = clamp(v_warp, 0.0, 1.0);
    vec4 color = texture2D(u_to, uv);
    if (u_mix < 1.0) color = mix(texture2D(u_from, uv), color, u_mix);
    vec2 center = v_uv - 0.5;
    color.rgb *= 1.0 - dot(center, center) * 0.3;
    float noise = hash(vec3(floor(v_uv * u_resolution), floor(u_time * 60.0)));
    color.rgb += (noise - 0.5) * 0.006;
    // Fold the theme gradient into this draw. A separate full-window gradient
    // under group opacity otherwise needs another compositor render surface.
    float shade = clamp((v_uv.x - 0.12) / 1.03, 0.0, 1.0) * u_shade.a;
    color.rgb = mix(clamp(color.rgb, 0.0, 1.0), u_shade.rgb, shade);
    gl_FragColor = color;
  }
`
