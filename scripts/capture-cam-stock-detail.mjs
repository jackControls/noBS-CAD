// Render a Rust stock-mesh capture for geometry/normal QA; no application state
// or user project is modified. Usage: node scripts/capture-cam-stock-detail.mjs
// /absolute/path/mesh.json /absolute/path/preview.png
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const [input, output] = process.argv.slice(2)
if (!input || !output) throw new Error('Provide the mesh JSON and output PNG paths')
const mesh = JSON.parse(await readFile(input, 'utf8'))
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1 })
  await page.setContent('<style>body{margin:0}canvas{display:block}</style><canvas width="1280" height="960"></canvas>')
  await page.evaluate(mesh => {
    const canvas = document.querySelector('canvas')
    const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true })
    if (!gl) throw new Error('WebGL2 unavailable')
    const shader = (type, source) => {
      const shader = gl.createShader(type)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader))
      return shader
    }
    const program = gl.createProgram()
    gl.attachShader(program, shader(gl.VERTEX_SHADER, `#version 300 es
      in vec3 position; in vec3 normal; uniform mat4 camera;
      out vec3 n; out vec3 p;
      void main(){ p=position; n=normal; gl_Position=camera*vec4(position,1.0); }`))
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float; in vec3 n; in vec3 p; uniform vec3 eye; out vec4 color;
      void main(){
        vec3 N=normalize(n); vec3 L=normalize(vec3(-0.4,-0.6,1.0));
        float light=0.27+0.52*max(dot(N,L),0.0)+0.18*max(dot(N,normalize(vec3(0.6,0.3,0.8))),0.0);
        float spec=0.11*pow(max(dot(N,normalize(L+normalize(eye-p))),0.0),30.0);
        color=vec4(vec3(0.21,0.57,0.27)*light+spec,1.0);
      }`))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
    gl.useProgram(program)
    for (const [name, data] of [['position', mesh.positions], ['normal', mesh.normals]]) {
      const buffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW)
      const location = gl.getAttribLocation(program, name)
      gl.enableVertexAttribArray(location)
      gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0)
    }
    const dot = (a,b) => a.reduce((s,x,i)=>s+x*b[i],0)
    const unit = a => a.map(x=>x/Math.hypot(...a))
    const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
    const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity]
    for (let i=0;i<mesh.positions.length;i++) { const k=i%3; min[k]=Math.min(min[k],mesh.positions[i]); max[k]=Math.max(max[k],mesh.positions[i]) }
    const center = min.map((v,i)=>(v+max[i])/2)
    const extent = Math.max(...max.map((v,i)=>v-min[i]))
    const eye = center.map((v,i)=>v+extent*[0.6,-0.9,0.95][i])
    const z = unit(eye.map((v,i)=>v-center[i]))
    const x = unit(cross([0,0,1],z)), y = cross(z,x)
    const view = [x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]
    const size = extent*0.56, aspect=canvas.width/canvas.height, near=0.01, far=extent*5
    const projection = [1/(size*aspect),0,0,0,0,1/size,0,0,0,0,-2/(far-near),0,0,0,-(far+near)/(far-near),1]
    const camera = Array(16).fill(0)
    for (let c=0;c<4;c++) for (let r=0;r<4;r++) for (let k=0;k<4;k++) camera[c*4+r]+=projection[k*4+r]*view[c*4+k]
    gl.uniformMatrix4fv(gl.getUniformLocation(program,'camera'), false, camera)
    gl.uniform3fv(gl.getUniformLocation(program,'eye'),eye)
    gl.enable(gl.DEPTH_TEST)
    gl.clearColor(0.86,0.89,0.92,1)
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLES,0,mesh.positions.length/3)
    gl.finish()
    if (gl.getError()!==gl.NO_ERROR) throw new Error('Stock render failed')
  }, mesh)
  await page.screenshot({ path: output })
  console.log(`Rendered ${mesh.triangle_count} triangles to ${output}`)
} finally {
  await browser.close()
}
