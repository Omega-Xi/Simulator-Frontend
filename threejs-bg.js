import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
    75, window.innerWidth/window.innerHeight,0.1,1000
);

const renderer = new THREE.WebGLRenderer({alpha:true});
renderer.setSize(window.innerWidth,window.innerHeight);
document.getElementById("bg").appendChild(renderer.domElement);

const geometry = new THREE.BufferGeometry();
const particlesCount = 2000;
const positions = new Float32Array(particlesCount*3);
const colors = new Float32Array(particlesCount*3);
for(let i=0;i<particlesCount;i++){
    //positions
    positions[i * 3] = (Math.random()-0.5)*200;
    positions[i * 3 + 1] = (Math.random()-0.5)*200;
    positions[i * 3 + 2] = (Math.random()-0.5)*200;

    // color (random RGB between 0-1)
    colors[i*3]=Math.random(); //R
    colors[i*3+1]=Math.random(); //G
    colors[i*3+2]=Math.random(); //B
}
geometry.setAttribute("position",new THREE.BufferAttribute(positions,3));
geometry.setAttribute("color",new THREE.BufferAttribute(colors,3))

const starTexture= createStarTexture();
const material = new THREE.PointsMaterial({
    map: starTexture,
    size:0.7,
    vertexColors:true,
    transparent: true,
    alphaTest: 0.1
});

const particles = new THREE.Points(geometry,material);
scene.add(particles);
camera.position.z=5;

// Animation loop
function animate(){
    requestAnimationFrame(animate);
    const positions = geometry.attributes.position.array;
    for (let i = 0; i < positions.length; i += 3) {
        positions[i+2] += 0.5; // move along z-axis
        if (positions[i+2] > 50) positions[i+2] = -200; // reset far back
    }
    geometry.attributes.position.needsUpdate = true;

    renderer.render(scene, camera);
}
animate();

// Resize handling
window.addEventListener("resize", ()=>{
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth,window.innerHeight);
});

// Mouse interactivity
document.addEventListener("mousemove", (event) => {
  const x = (event.clientX / window.innerWidth) * 2 - 1;
  const y = -(event.clientY / window.innerHeight) * 2 + 1;
  camera.rotation.y = x * 0.1;
  camera.rotation.x = y * 0.1;
});
// Touch interactivity
document.addEventListener("touchmove", (event) => {
  const touch = event.touches[0];
  const x = (touch.clientX / window.innerWidth) * 2 - 1;
  const y = -(touch.clientY / window.innerHeight) * 2 + 1;
  camera.rotation.y = x * 1;
  camera.rotation.x = y * 1;
});

// Create star texture
function createStarTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");

    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "white");
    gradient.addColorStop(0.2, "white");
    gradient.addColorStop(0.4, "rgba(255,255,255,0.6)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
}