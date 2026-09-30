import * as THREE from './vendor-three.module.min.js';

// A single, mirrored bridge: the reference's silhouette and landmarks, with
// exported Howling Abyss props decorating a traversable stone causeway.
export function buildAbyssEnvironment(scene, makeTexture, addAsset) {
  scene.background = new THREE.Color('#061521');
  scene.fog = new THREE.FogExp2('#102e42', .0065);
  const stone = makeTexture((ctx, w, h) => {
    ctx.fillStyle = '#273f50'; ctx.fillRect(0, 0, w, h);
    for (let row = 0; row < 8; row++) for (let col = -1; col < 8; col++) {
      const shade = 62 + (row * 17 + col * 31 + 256) % 30;
      const x = col * 37 + (row % 2) * 18, y = row * 33;
      ctx.fillStyle = `rgb(${shade},${shade + 24},${shade + 37})`; ctx.fillRect(x + 1, y + 1, 34, 30);
      ctx.strokeStyle = '#a9c5cf66'; ctx.strokeRect(x + 2, y + 2, 32, 27);
      ctx.fillStyle = '#132c3d66'; ctx.fillRect(x + 3, y + 27, 30, 3);
    }
    ctx.strokeStyle = '#d9ecf033'; ctx.lineWidth = 1;
    for (let i = 0; i < 45; i++) { const x = (i * 73) % w, y = (i * 47) % h; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 9, y + 3); ctx.lineTo(x + 14, y - 4); ctx.stroke(); }
  }, 23, 2);
  const floorMaterial = new THREE.MeshStandardMaterial({map:stone,color:0xb5ccd9,roughness:.92});
  const darkStone = new THREE.MeshStandardMaterial({color:0x203a4c,roughness:.95});
  const snow = new THREE.MeshStandardMaterial({color:0xc0d9e0,roughness:1});
  const box = (x,y,z,w,h,d,material) => { const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);return mesh; };
  box(0,-1.8,0,240,3.6,20,floorMaterial);
  for (const sign of [-1,1]) {
    box(sign*104,-2.1,0,29,4.1,29,floorMaterial);
    box(sign*119,-.15,0,1,1,29,darkStone);
    for (const z of [-14.5,14.5]) box(sign*105,.5,z,29,1.5,1.1,darkStone);
    for (const z of [-19,19]) {
      // The camera-facing wall is a cutaway so the fountain and nexus stay visible.
      const front=z>0;
      const wall=box(sign*108,front?-2:7,z,17,front?6:19,5,darkStone);wall.rotation.z=sign*.025;
      if(!front)for(let j=-1;j<=1;j++)box(sign*108+j*5,17,z,3.4,5,5.4,darkStone);
    }
    for (const x of [32,60,76,100]) {
      const ring=new THREE.Mesh(new THREE.RingGeometry(x===100?5:3.1,x===100?5.18:3.2,48),new THREE.MeshBasicMaterial({color:sign<0?0x5ebede:0xba6784,transparent:true,opacity:.35,depthWrite:false}));
      ring.rotation.x=-Math.PI/2;ring.position.set(sign*x,.035,0);scene.add(ring);
    }
  }
  for (const z of [-9.65,9.65]) {
    box(0,.2,z,188,.9,.65,darkStone);
    box(0,.72,z,188,.16,.85,snow);
    box(0,-5.8,z,226,5.5,1.8,darkStone);
  }
  const flameTexture=makeTexture((ctx,w,h)=>{const g=ctx.createRadialGradient(w/2,h*.58,0,w/2,h*.58,w*.5);g.addColorStop(0,'#fff9ca');g.addColorStop(.16,'#ffb44b');g.addColorStop(.4,'#ed591a99');g.addColorStop(1,'#df301000');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);});
  for (let x=-88;x<=88;x+=22) for(const side of [-1,1]) {
    box(x,1.05,side*9.2,1.05,2.1,1.05,darkStone);
    const bowl=new THREE.Mesh(new THREE.CylinderGeometry(.6,.35,.35,8),darkStone);bowl.position.set(x,2.15,side*9.2);scene.add(bowl);
    const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:flameTexture,color:0xffba64,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));glow.position.set(x,2.9,side*9.2);glow.scale.set(2,3.4,1);scene.add(glow);
    addAsset('ha_ap_bridgelanestatue.glb',{x,y:-6.8,z:side*13.1},{size:10,axis:'y',rotation:side<0?Math.PI:0,animate:false});
  }
  for (let x=-77;x<=77;x+=22) for(const side of [-1,1]) {
    addAsset('ha_ap_chains.glb',{x,y:1.5,z:side*10.3},{size:20,axis:'x',anchor:'top',animate:true});
    addAsset('ha_ap_periphbridge.glb',{x,y:-11,z:side*13.3},{size:21,axis:'x',animate:false});
  }
  for(const x of [-91,91])for(const side of [-1,1])addAsset('ha_ap_cutaway.glb',{x,y:-6,z:side*13},{size:15,axis:'x',rotation:side<0?Math.PI:0,animate:false});
  for(const x of [-45,45])addAsset('ha_ap_bannermidbridge.glb',{x,y:1.8,z:-10.8},{size:5,axis:'x',anchor:'top',animate:true});
  // Tall cliffs frame the bridge; the lower fog plane reads as a deep chasm.
  for(let x=-132;x<=132;x+=18)for(const side of [-1,1]) {
    const cliff=new THREE.Mesh(new THREE.CylinderGeometry(5,9,28+(Math.abs(x)%11),5),darkStone);
    cliff.position.set(x,side>0?-24:-13,side*(29+(Math.abs(x)%7)));cliff.rotation.y=x;cliff.castShadow=true;scene.add(cliff);
    const ice=new THREE.Mesh(new THREE.ConeGeometry(1.3,9,5),snow);ice.rotation.z=Math.PI;ice.position.set(x+3,-8,side*20);scene.add(ice);
  }
  const abyss=new THREE.Mesh(new THREE.PlaneGeometry(370,180),new THREE.MeshBasicMaterial({color:0x102d42}));abyss.rotation.x=-Math.PI/2;abyss.position.y=-31;scene.add(abyss);
  const snowPositions=[];for(let i=0;i<450;i++)snowPositions.push(-145+(i*41)%290,2+(i*17)%28,-40+(i*29)%80);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(snowPositions,3));scene.add(new THREE.Points(geometry,new THREE.PointsMaterial({color:0xbadbe8,size:.1,transparent:true,opacity:.45,depthWrite:false})));
}
