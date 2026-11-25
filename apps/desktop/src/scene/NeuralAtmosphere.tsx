import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { showNeuralAtmosphere } from './neural-navigation-visuals'

// Ambient motion is presentation; activity still comes from observed signals.
export function NeuralAtmosphere({ inspecting, navigating = false }: { inspecting: boolean; navigating?: boolean }) {
  const envelope = useRef<THREE.Mesh>(null), cloud = useRef<THREE.Mesh>(null)
  const uniforms = useMemo(() => ({ time: { value: 0 }, visibility: { value: 1 }, eye: { value: new THREE.Vector3() } }), [])
  useFrame(({ clock, camera }, dt) => {
    uniforms.time.value = clock.elapsedTime
    if (navigating) {
      uniforms.visibility.value = 0
      if (envelope.current) envelope.current.visible = false
      if (cloud.current) cloud.current.visible = false
      return
    }
    if (envelope.current) {
      envelope.current.updateWorldMatrix(true, false)
      uniforms.eye.value.copy(camera.position)
      envelope.current.worldToLocal(uniforms.eye.value)
    }
    const visible = inspecting || uniforms.eye.value.length() < 1.7 ? 0 : 1
    uniforms.visibility.value += (visible - uniforms.visibility.value) * Math.min(1, dt * 6)
    const draw = showNeuralAtmosphere(false, uniforms.visibility.value)
    if (envelope.current) envelope.current.visible = draw
    if (cloud.current) cloud.current.visible = draw
  })
  return <group>
    <mesh ref={envelope} renderOrder={2}>
      <sphereGeometry args={[1.58, 96, 64]} />
      <shaderMaterial uniforms={uniforms} transparent depthWrite={false} side={THREE.DoubleSide}
        vertexShader={`uniform float time; varying vec3 p; varying vec3 n; varying vec3 view; void main(){vec3 q=position;float wave=sin(q.x*3.1+time*.52)*sin(q.y*2.7-time*.37)+.45*sin(q.z*5.0+q.x*2.0-time*.63);q+=normal*wave*.095;p=q;n=normalize(normalMatrix*normal);vec4 v=modelViewMatrix*vec4(q,1.0);view=normalize(-v.xyz);gl_Position=projectionMatrix*v;}`}
        fragmentShader={`uniform float time;uniform float visibility;varying vec3 p;varying vec3 n;varying vec3 view;void main(){if(visibility<.01)discard;float rim=pow(1.0-abs(dot(normalize(n),normalize(view))),2.5);float flow=.5+.5*sin(p.y*9.0+p.x*3.0+sin(p.z*5.0-time*.4)-time*.6);vec3 color=mix(vec3(.24,.045,.42),vec3(.62,.23,.82),flow);gl_FragColor=vec4(color,(.012+rim*.2)*visibility);}`} />
    </mesh>
    <mesh ref={cloud} renderOrder={1}>
      <sphereGeometry args={[1.45, 32, 24]} />
      <shaderMaterial uniforms={uniforms} transparent depthWrite={false} side={THREE.BackSide}
        vertexShader={`varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`}
        fragmentShader={`uniform float time;uniform float visibility;uniform vec3 eye;varying vec3 p;
          float field(vec3 q){return sin(q.x*4.0+sin(q.z*3.0))*sin(q.y*4.7+sin(q.x*2.7))*sin(q.z*3.8+sin(q.y*3.1));}
          void main(){if(visibility<.01)discard;vec3 ray=normalize(p-eye);float b=dot(eye,ray);float d=b*b-dot(eye,eye)+2.1025;if(d<0.0)discard;float a=max(0.0,-b-sqrt(d));float end=-b+sqrt(d);float stepSize=(end-a)/16.0;vec3 color=vec3(0.0);float alpha=0.0;for(int i=0;i<16;i++){float distance=a+(float(i)+.5)*stepSize;vec3 q=eye+ray*distance;float edge=1.0-smoothstep(.92,1.48,length(q));float nearFade=smoothstep(.045,.42,distance);float flow=field(q+vec3(time*.055,-time*.035,time*.025));float cloud=smoothstep(.08,.66,flow);float filament=pow(max(0.0,sin(q.x*5.2+q.y*3.1-q.z*4.0+flow*3.0-time*.48)),5.0);float density=(cloud*.72+filament*.28)*edge*nearFade*stepSize*.27;float band=.5+.5*sin(q.x*4.4-q.y*3.8+q.z*2.6+flow*2.0-time*.18);vec3 blue=mix(vec3(.025,.18,.92),vec3(.0,.84,1.0),smoothstep(.18,.78,band));vec3 violet=mix(vec3(.35,.055,.92),vec3(1.0,.08,.48),smoothstep(.15,.86,band));vec3 fire=mix(vec3(1.0,.22,.035),vec3(1.0,.86,.27),smoothstep(.2,.82,band));vec3 tint=mix(blue,violet,smoothstep(-.35,.55,flow));tint=mix(tint,fire,smoothstep(.42,.92,flow)*.88);color+=(1.0-alpha)*density*tint;alpha+=(1.0-alpha)*density;}if(alpha<.001)discard;gl_FragColor=vec4(color/max(alpha,.001),min(alpha,.25));}`}/>
    </mesh>
  </group>
}
