import { quadVertex, blurFragment, flowVertex, flowFragment } from './shaders'

interface Surface { texture: WebGLTexture, framebuffer: WebGLFramebuffer }

// The artwork is already blurred at 128px. Its low-frequency flow only needs a
// vertex grid, rather than four noise evaluations for every output pixel.
// Gentle uses a smaller grid for its smaller surface. Both retain the same
// equations and clock, with no full-size intermediate texture.
const BLUR_SIZE = 128

export const createKawarpRenderer = (canvas: HTMLCanvasElement) => {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'low-power' })
  if (!gl || gl.isContextLost()) return null
  const programs: WebGLProgram[] = []
  const shaders: WebGLShader[] = []
  const buffers: WebGLBuffer[] = []
  const textures: WebGLTexture[] = []
  const framebuffers: WebGLFramebuffer[] = []
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    programs.forEach(value => { gl.deleteProgram(value) })
    shaders.forEach(value => { gl.deleteShader(value) })
    buffers.forEach(value => { gl.deleteBuffer(value) })
    textures.forEach(value => { gl.deleteTexture(value) })
    framebuffers.forEach(value => { gl.deleteFramebuffer(value) })
  }
  try {
    const program = (vertex: string, fragment: string, names: string[]) => {
      const result = gl.createProgram()
      if (!result) throw new Error('Background program unavailable')
      programs.push(result)
      for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
        const shader = gl.createShader(type)
        if (!shader) throw new Error('Background shader unavailable')
        shaders.push(shader)
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Background shader compilation failed')
        gl.attachShader(result, shader)
      }
      gl.bindAttribLocation(result, 0, 'a_uv')
      gl.linkProgram(result)
      if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error('Background program link failed')
      const uniforms = Object.fromEntries(names.map(name => [name, gl.getUniformLocation(result, name)]))
      return { result, uniforms }
    }
    const blur = program(quadVertex, blurFragment, ['u_texture', 'u_offset'])
    const flow = program(flowVertex, flowFragment, ['u_from', 'u_to', 'u_mix', 'u_time', 'u_resolution', 'u_shade'])
    const buffer = (data: Float32Array | Uint16Array, target: number = gl.ARRAY_BUFFER) => {
      const result = gl.createBuffer()
      if (!result) throw new Error('Background buffer unavailable')
      buffers.push(result)
      gl.bindBuffer(target, result)
      gl.bufferData(target, data, gl.STATIC_DRAW)
      return result
    }
    const quad = buffer(new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]))
    const grid = (size: number) => {
      const vertices = new Float32Array((size + 1) ** 2 * 2)
      const indices = new Uint16Array(size * size * 6)
      let vertex = 0
      let index = 0
      for (let y = 0; y <= size; y++) {
        for (let x = 0; x <= size; x++) {
          vertices[vertex++] = x / size
          vertices[vertex++] = y / size
          if (x === size || y === size) continue
          const a = y * (size + 1) + x
          indices.set([a, a + 1, a + size + 1, a + size + 1, a + 1, a + size + 2], index)
          index += 6
        }
      }
      return { vertices: buffer(vertices), elements: buffer(indices, gl.ELEMENT_ARRAY_BUFFER), count: indices.length }
    }
    const fullMesh = grid(64)
    const gentleMesh = grid(32)
    const texture = () => {
      const result = gl.createTexture()
      if (!result) throw new Error('Background texture unavailable')
      textures.push(result)
      gl.bindTexture(gl.TEXTURE_2D, result)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      return result
    }
    const half = gl.getExtension('OES_texture_half_float')
    const linear = gl.getExtension('OES_texture_half_float_linear')
    if (half) gl.getExtension('EXT_color_buffer_half_float')
    const surface = (): Surface => {
      const image = texture()
      const framebuffer = gl.createFramebuffer()
      if (!framebuffer) throw new Error('Background framebuffer unavailable')
      framebuffers.push(framebuffer)
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, BLUR_SIZE, BLUR_SIZE, 0, gl.RGBA, half && linear ? half.HALF_FLOAT_OES : gl.UNSIGNED_BYTE, null)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, image, 0)
      // Some drivers expose half-float sampling without renderable half-floats.
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, BLUR_SIZE, BLUR_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Background framebuffer incomplete')
      }
      return { texture: image, framebuffer }
    }
    const source = texture()
    const scratch = [surface(), surface()]
    let from = surface()
    let to = surface()
    let hasImage = false
    let start = 0
    let duration = 1
    let previousWidth = 0
    let previousHeight = 0
    let previousTime = NaN
    let previousMesh: typeof fullMesh | undefined
    let shade: readonly number[] = [0, 0, 0, 0]
    const geometry = (value: WebGLBuffer) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, value)
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    }
    const upload = (image: HTMLCanvasElement, target: Surface) => {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, source)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
      gl.useProgram(blur.result)
      geometry(quad)
      gl.viewport(0, 0, BLUR_SIZE, BLUR_SIZE)
      gl.uniform1i(blur.uniforms.u_texture, 0)
      const pass = (input: WebGLTexture, output: Surface, offset: number) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, output.framebuffer)
        gl.bindTexture(gl.TEXTURE_2D, input)
        gl.uniform1f(blur.uniforms.u_offset, offset)
        gl.drawArrays(gl.TRIANGLES, 0, 6)
      }
      // Match Kawarp's downsample, eight blur passes and final copy exactly.
      pass(source, scratch[0], 0)
      for (let i = 0; i < 8; i++) pass(scratch[i % 2].texture, scratch[(i + 1) % 2], i + 0.5)
      pass(scratch[0].texture, target, 0)
    }
    return {
      setSource(image: HTMLCanvasElement, milliseconds: number, previous?: HTMLCanvasElement) {
        if (disposed || gl.isContextLost()) return
        const swap = from
        from = to
        to = swap
        if (previous) upload(previous, from)
        else if (!hasImage) upload(image, from)
        upload(image, to)
        duration = hasImage || previous ? Math.max(1, milliseconds) : 1
        start = performance.now()
        hasImage = true
        previousTime = NaN
      },
      finishTransition() { duration = 1 },
      setShade(color: readonly number[]) {
        if (color.every((value, index) => value === shade[index])) return
        shade = color.slice()
        previousTime = NaN
      },
      draw(width: number, height: number, time: number, transitioning: boolean, gentle = false) {
        if (disposed || !hasImage || gl.isContextLost()) return
        const mesh = gentle ? gentleMesh : fullMesh
        if (!transitioning && previousWidth === width && previousHeight === height && previousTime === time && previousMesh === mesh) return
        if (canvas.width !== width) canvas.width = width
        if (canvas.height !== height) canvas.height = height
        gl.useProgram(flow.result)
        geometry(mesh.vertices)
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.elements)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.viewport(0, 0, width, height)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, from.texture)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, to.texture)
        gl.uniform1i(flow.uniforms.u_from, 0)
        gl.uniform1i(flow.uniforms.u_to, 1)
        const progress = Math.min(1, Math.max(0, (performance.now() - start) / duration))
        gl.uniform1f(flow.uniforms.u_mix, 0.5 - 0.5 * Math.cos(progress * Math.PI))
        gl.uniform1f(flow.uniforms.u_time, time)
        gl.uniform2f(flow.uniforms.u_resolution, width, height)
        gl.uniform4f(flow.uniforms.u_shade, shade[0] / 255, shade[1] / 255, shade[2] / 255, shade[3] * 0.1)
        gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0)
        previousWidth = width
        previousHeight = height
        previousTime = time
        previousMesh = mesh
      },
      dispose,
    }
  } catch {
    dispose()
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return null
  }
}
