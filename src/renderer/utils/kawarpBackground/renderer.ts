import { quadVertex, blurFragment, flowVertex, flowFragment } from './shaders'

interface Surface { texture: WebGLTexture, framebuffer: WebGLFramebuffer, size: number }
interface Chain { levels: Surface[], scratch: Surface[] }

const SOURCE_SIZE = 256
const LAYER_SIZES = [128, 64, 32]

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
    const blur = program(quadVertex, blurFragment, ['u_texture', 'u_offset', 'u_sourceSize'])
    const flow = program(flowVertex, flowFragment, [
      'u_to0', 'u_to1', 'u_to2', 'u_from0', 'u_from1', 'u_from2',
      'u_mix', 'u_time', 'u_resolution', 'u_shade',
    ])
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
    const fullMesh = grid(48)
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
    const surface = (size: number): Surface => {
      const image = texture()
      const framebuffer = gl.createFramebuffer()
      if (!framebuffer) throw new Error('Background framebuffer unavailable')
      framebuffers.push(framebuffer)
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, image, 0)
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Background framebuffer incomplete')
      return { texture: image, framebuffer, size }
    }
    const chain = (): Chain => ({
      levels: LAYER_SIZES.map(surface),
      scratch: LAYER_SIZES.map(surface),
    })
    const source = texture()
    const from = chain()
    const to = chain()
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
    const pass = (input: WebGLTexture, output: Surface, sourceSize: number, offset: number) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, output.framebuffer)
      gl.viewport(0, 0, output.size, output.size)
      gl.useProgram(blur.result)
      geometry(quad)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, input)
      gl.uniform1i(blur.uniforms.u_texture, 0)
      gl.uniform1f(blur.uniforms.u_offset, offset)
      gl.uniform2f(blur.uniforms.u_sourceSize, sourceSize, sourceSize)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }
    const build = (target: Chain, image: HTMLCanvasElement, upload: boolean) => {
      if (upload) {
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, source)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
      }
      // 256 -> 128, then two blur passes; 128 -> 64 and 64 -> 32 each drop one
      // octave. Every pass is a 4-tap box at its input resolution, so the whole
      // chain costs a handful of tiny draws once per cover.
      const [base, mid, detail] = target.levels
      const [scratchBase, scratchMid, scratchDetail] = target.scratch
      pass(source, base, SOURCE_SIZE, 1)
      pass(base.texture, scratchBase, base.size, 1)
      pass(scratchBase.texture, base, base.size, 1)
      pass(base.texture, mid, base.size, 1)
      pass(mid.texture, scratchMid, mid.size, 1)
      pass(scratchMid.texture, mid, mid.size, 1)
      pass(mid.texture, detail, mid.size, 1)
      pass(detail.texture, scratchDetail, detail.size, 1)
      pass(scratchDetail.texture, detail, detail.size, 1)
    }
    const renderTexture = (unit: number, value: WebGLTexture) => {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, value)
      gl.uniform1i(flow.uniforms[['u_to0', 'u_to1', 'u_to2', 'u_from0', 'u_from1', 'u_from2'][unit]], unit)
    }
    return {
      setSource(image: HTMLCanvasElement, milliseconds: number, previous?: HTMLCanvasElement) {
        if (disposed || gl.isContextLost()) return
        build(to, image, true)
        if (previous) build(from, previous, true)
        else if (!hasImage) build(from, image, true)
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
        renderTexture(0, to.levels[0].texture)
        renderTexture(1, to.levels[1].texture)
        renderTexture(2, to.levels[2].texture)
        renderTexture(3, from.levels[0].texture)
        renderTexture(4, from.levels[1].texture)
        renderTexture(5, from.levels[2].texture)
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
