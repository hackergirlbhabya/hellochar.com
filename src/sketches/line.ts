import * as $ from "jquery";
import { parse } from "query-string";
import * as THREE from "three";

import { GravityShader } from "../common/gravityShader";
import { ISketch, SketchAudioContext } from "../sketch";

const NUM_PARTICLES = parse(location.search).p ||
    // cheap mobile detection
    (screen.width > 1024 ? 15000 : 5000);
let SIMULATION_SPEED = 3;
let GRAVITY_CONSTANT = 320;
// speed becomes this percentage of its original speed every second
let PULLING_DRAG_CONSTANT = 0.93075095702;
let INERTIAL_DRAG_CONSTANT = 0.53913643334;

function createAudioGroup(audioContext: SketchAudioContext) {
    const backgroundAudio = $("<audio autoplay loop>")
        .append('<source src="/assets/sketches/line/line_background.ogg" type="audio/ogg">')
        .append('<source src="/assets/sketches/line/line_background.mp3" type="audio/mp3">') as JQuery<HTMLMediaElement>;

    let sourceNode = audioContext.createMediaElementSource(backgroundAudio[0]);
    $("body").append(backgroundAudio);

    let backgroundAudioGain = audioContext.createGain();
    backgroundAudioGain.gain.value = 0.5;
    sourceNode.connect(backgroundAudioGain);
    backgroundAudioGain.connect(audioContext.gain);

    // white noise
    let noise = (function() {
        let node = audioContext.createBufferSource()
            , buffer = audioContext.createBuffer(1, audioContext.sampleRate * 5, audioContext.sampleRate)
            , data = buffer.getChannelData(0);
        for (let i = 0; i < buffer.length; i++) {
            data[i] = Math.random();
        }
        node.buffer = buffer;
        node.loop = true;
        node.start(0);
        return node;
    })();

    // // pink noise from http://noisehack.com/generate-noise-web-audio-api/
    // var noise = (function() {
    //     var bufferSize = 4096;
    //     var b0, b1, b2, b3, b4, b5, b6;
    //     b0 = b1 = b2 = b3 = b4 = b5 = b6 = 0.0;
    //     var node = audioContext.createScriptProcessor(bufferSize, 1, 1);
    //     node.onaudioprocess = function(e) {
    //         var output = e.outputBuffer.getChannelData(0);
    //         for (var i = 0; i < bufferSize; i++) {
    //             var white = Math.random() * 2 - 1;
    //             b0 = 0.99886 * b0 + white * 0.0555179;
    //             b1 = 0.99332 * b1 + white * 0.0750759;
    //             b2 = 0.96900 * b2 + white * 0.1538520;
    //             b3 = 0.86650 * b3 + white * 0.3104856;
    //             b4 = 0.55000 * b4 + white * 0.5329522;
    //             b5 = -0.7616 * b5 - white * 0.0168980;
    //             output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    //             output[i] *= 0.11; // (roughly) compensate for gain
    //             b6 = white * 0.115926;
    //         }
    //     }
    //     return node;
    // })();

    let noiseSourceGain = audioContext.createGain();
    noiseSourceGain.gain.value = 0;
    noise.connect(noiseSourceGain);

    let noiseFilter = audioContext.createBiquadFilter();
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.value = 0;
    noiseFilter.Q.value = 1.0;
    noiseSourceGain.connect(noiseFilter);

    let noiseShelf = audioContext.createBiquadFilter();
    noiseShelf.type = "lowshelf";
    noiseShelf.frequency.value = 2200;
    noiseShelf.gain.value = 8;
    noiseFilter.connect(noiseShelf);

    let noiseGain = audioContext.createGain();
    noiseGain.gain.value = 1.0;
    noiseShelf.connect(noiseGain);

    let BASE_FREQUENCY = 320;
    function detuned(freq: number, centsOffset: number) {
        return freq * Math.pow(2, centsOffset / 1200);
    }
    function semitone(freq: number, semitoneOffset: number) {
        return detuned(freq, semitoneOffset * 100);
    }
    let source1 = (function() {
        let node = audioContext.createOscillator();
        node.frequency.value = detuned(BASE_FREQUENCY / 2, 2);
        node.type = "square";
        node.start(0);

        let gain = audioContext.createGain();
        gain.gain.value = 0.30;
        node.connect(gain);

        return gain;
    })();
    let source2 = (function() {
        let node = audioContext.createOscillator();
        node.frequency.value = BASE_FREQUENCY;
        node.type = "sawtooth";
        node.start(0);

        let gain = audioContext.createGain();
        gain.gain.value = 0.30;
        node.connect(gain);

        return gain;
    })();

    let sourceLow = (function() {
        let node = audioContext.createOscillator();
        node.frequency.value = BASE_FREQUENCY / 4;
        node.type = "sawtooth";
        node.start(0);

        let gain = audioContext.createGain();
        gain.gain.value = 0.90;
        node.connect(gain);

        return gain;
    })();

    function makeChordSource(BASE_FREQUENCY: number) {
        let base = audioContext.createOscillator();
        base.frequency.value = BASE_FREQUENCY;
        base.start(0);

        let octave = audioContext.createOscillator();
        octave.frequency.value = semitone(BASE_FREQUENCY, 12);
        octave.type = "sawtooth";
        octave.start(0);

        let fifth = audioContext.createOscillator();
        fifth.frequency.value = semitone(BASE_FREQUENCY, 12 + 7);
        fifth.type = "sawtooth";
        fifth.start(0);

        let octave2 = audioContext.createOscillator();
        octave2.frequency.value = semitone(BASE_FREQUENCY, 24);
        octave2.type = "sawtooth";
        octave2.start(0);

        let fourth = audioContext.createOscillator();
        fourth.frequency.value = semitone(BASE_FREQUENCY, 24 + 4);
        fourth.start(0);

        let gain = audioContext.createGain();
        gain.gain.value = 0.0;
        base.connect(gain);
        octave.connect(gain);
        fifth.connect(gain);
        octave2.connect(gain);
        fourth.connect(gain);

        return gain;
    }
    let chordSource = makeChordSource(BASE_FREQUENCY);
    let chordHigh = makeChordSource(BASE_FREQUENCY * 8);

    let sourceGain = audioContext.createGain();
    sourceGain.gain.value = 0.0;

    let sourceLfo = audioContext.createOscillator();
    sourceLfo.frequency.value = 8.66;
    sourceLfo.start(0);

    let lfoGain = audioContext.createGain();
    lfoGain.gain.value = 0;

    sourceLfo.connect(lfoGain);

    let filter = audioContext.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 0;
    filter.Q.value = 2.18;

    let filter2 = audioContext.createBiquadFilter();
    filter2.type = "bandpass";
    filter2.frequency.value = 0;
    filter2.Q.value = 2.18;

    let filterGain = audioContext.createGain();
    filterGain.gain.value = 0.4;

    chordSource.connect(sourceGain);
    source1.connect(sourceGain);
    source2.connect(sourceGain);
    sourceLow.connect(sourceGain);
    chordHigh.connect(filter);
    sourceGain.connect(filter);

    lfoGain.connect(filter.frequency);
    lfoGain.connect(filter2.frequency);
    filter.connect(filter2);
    filter2.connect(filterGain);

    let audioGain = audioContext.createGain();
    audioGain.gain.value = 1.0;

    noiseGain.connect(audioGain);
    filterGain.connect(audioGain);

    let analyser = audioContext.createAnalyser();
    audioGain.connect(analyser);

    let compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -50;
    compressor.knee.value = 12;
    compressor.ratio.value = 2;
    analyser.connect(compressor);

    let highAttenuation = audioContext.createBiquadFilter();
    highAttenuation.type = "highshelf";
    highAttenuation.frequency.value = BASE_FREQUENCY * 4;
    highAttenuation.gain.value = -6;
    compressor.connect(highAttenuation);

    let highAttenuation2 = audioContext.createBiquadFilter();
    highAttenuation2.type = "highshelf";
    highAttenuation2.frequency.value = BASE_FREQUENCY * 8;
    highAttenuation2.gain.value = -6;
    highAttenuation.connect(highAttenuation2);

    highAttenuation2.connect(audioContext.gain);

    return {
        analyser,
        chordGain: chordSource,
        sourceGain,
        sourceLfo,
        lfoGain,
        filter,
        filter2,
        filterGain,
        setFrequency(freq: number) {
            filter.frequency.value = freq;
            filter2.frequency.value = freq;
            lfoGain.gain.value = freq * .06;
        },
        setNoiseFrequency(freq: number) {
            noiseFilter.frequency.value = freq;
        },
        setVolume(volume: number) {
            sourceGain.gain.value = volume / 9;
            noiseSourceGain.gain.value = volume * 0.05;
            chordSource.gain.value = 0.05;
            chordHigh.gain.value = volume / 40;
        },
        setBackgroundVolume(volume: number) {
            backgroundAudioGain.gain.value = volume;
        },
    };
}

function reset() {
    for (let i = 0; i < NUM_PARTICLES; i++) {
        particles[i].dx = 0;
        particles[i].dy = 0;
    }
    returnToStartPower = 0.01;
}

let attractorGeometry = new THREE.RingGeometry(15, 18, 32);
let attractorMaterialSolid = new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
    color: 0xe2cfb3,
    transparent: true,
    opacity: 0.6,
});

function makeAttractor(x = 0, y = 0, power = 0) {
    const mesh = new THREE.Object3D();
    mesh.position.set(x, y, -100);
    for (let i = 0; i < 10; i++) {
        // var ring = THREE.SceneUtils.createMultiMaterialObject(attractorGeometry, [attractorMaterialSolid, attractorMaterialStroke]);
        let ring = new THREE.Mesh(attractorGeometry, attractorMaterialSolid);
        let scale = 1 + Math.pow(i / 10, 2) * 2;
        ring.scale.set(scale, scale, scale);
        mesh.add(ring);
    }
    mesh.visible = false;

    return {
        x,
        y,
        handMesh: null,
        mesh,
        power,
    };
}

let attractors = [
    makeAttractor(),
    makeAttractor(),
    makeAttractor(),
    makeAttractor(),
    makeAttractor(),
];

let audioContext: SketchAudioContext;
let audioGroup: any;
let canvas: HTMLCanvasElement;
let dragConstant;
let particles: IParticle[] = [];
let returnToStartPower = 0;

let mouseX = 0, mouseY = 0;

// threejs stuff
let camera: THREE.OrthographicCamera;
let composer: THREE.EffectComposer;
let filter: THREE.ShaderPass;
let geometry: THREE.Geometry;
let pointCloud: THREE.Points;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;

interface IParticle {
    x: number;
    y: number;
    dx: number;
    dy: number;
    vertex: THREE.Vertex | null;
}

function init(_renderer: THREE.WebGLRenderer, _audioContext: SketchAudioContext) {
    audioContext = _audioContext;
    audioGroup = createAudioGroup(audioContext);
    canvas = _renderer.domElement;

    scene = new THREE.Scene();
    renderer = _renderer;
    camera = new THREE.OrthographicCamera(0, canvas.width, 0, canvas.height, 1, 1000);
    camera.position.z = 500;

    // attractors.push(makeAttractor(30, canvas.height/2, 1));
    // attractors.push(makeAttractor(canvas.width - 30, canvas.height/2, 1));

    attractors.forEach(function(attractor) {
        scene.add(attractor.mesh);
    });

    for (let i = 0; i < NUM_PARTICLES; i++) {
        particles[i] = {
            x: i * canvas.width / NUM_PARTICLES,
            y: canvas.height / 2 + (i % 3) - 1,
            dx: 0,
            dy: 0,
            vertex: null,
        };
    }
    instantiatePointCloudAndGeometry();

    composer = new THREE.EffectComposer(renderer);
    composer.addPass(new THREE.RenderPass(scene, camera));
    filter = new THREE.ShaderPass(GravityShader);
    filter.uniforms.iResolution.value = new THREE.Vector2(canvas.width, canvas.height);
    const gamma = parse(location.search).gamma;
    if (gamma) {
        filter.uniforms.gamma.value = gamma;
    }
    filter.renderToScreen = true;
    composer.addPass(filter);
}

function animate(millisElapsed: number) {
    let allAttractorPowers = attractors.reduce(function(b, a) { return a.power + b; }, 0);
    dragConstant = (allAttractorPowers > 0.1) ? PULLING_DRAG_CONSTANT : INERTIAL_DRAG_CONSTANT;

    attractors.forEach(function(attractor) {
        attractor.mesh.position.z = -100;
        attractor.mesh.children.forEach(function(child, idx) {
            child.rotation.y += (10 - idx) / 20;
        });
        attractor.mesh.rotation.x = attractor.power;
        const scale = attractor.power * 0.7 + 0.3;
        attractor.mesh.scale.set(scale, scale, scale);
    });

    filter.uniforms.iMouse.value.set(attractors[0].x, renderer.domElement.height - attractors[0].y);
    let timeStep = millisElapsed / 1000 * SIMULATION_SPEED;
    if (returnToStartPower > 0 && returnToStartPower < 1) {
        returnToStartPower *= 1.01;
    }
    let sizeScaledGravityConstant = GRAVITY_CONSTANT * Math.min(Math.pow(2, canvas.width / 836 - 1), 1);

    let averageX = 0, averageY = 0;
    let averageVel2 = 0;
    let nonzeroAttractors = attractors.filter(function(attractor) { return attractor.power > 0; });

    for (let i = 0; i < NUM_PARTICLES; i++) {
        let particle = particles[i];
        nonzeroAttractors.forEach(function(attractor) {
            let dx = attractor.x - particle.x;
            let dy = attractor.y - particle.y;
            let length2 = Math.sqrt(dx * dx + dy * dy);
            let forceX = attractor.power * sizeScaledGravityConstant * dx / length2;
            let forceY = attractor.power * sizeScaledGravityConstant * dy / length2;

            particle.dx += forceX * timeStep;
            particle.dy += forceY * timeStep;
        });
        particle.dx *= Math.pow(dragConstant, timeStep);
        particle.dy *= Math.pow(dragConstant, timeStep);

        particle.x += particle.dx * timeStep;
        particle.y += particle.dy * timeStep;
        if (particle.x < -canvas.width || particle.x > canvas.width * 2 || particle.y < -canvas.width || particle.y > canvas.height * 2) {
            particle.x = Math.random() * canvas.width;
            particle.y = canvas.height / 2;
            particle.dx = particle.dy = 0;
        }

        let wantedX = i * canvas.width / NUM_PARTICLES;
        let wantedY = canvas.height / 2;
        if (returnToStartPower > 0) {
            particle.x -= (particle.x - wantedX) * returnToStartPower;
            particle.y -= (particle.y - wantedY) * returnToStartPower;
        }

        particle.vertex!.x = particle.x;
        particle.vertex!.y = particle.y;
        averageX += particle.x;
        averageY += particle.y;
        averageVel2 += particle.dx * particle.dx + particle.dy * particle.dy;
    }
    averageX /= NUM_PARTICLES;
    averageY /= NUM_PARTICLES;
    averageVel2 /= NUM_PARTICLES;
    let varianceX2 = 0;
    let varianceY2 = 0;
    let varianceVel22 = 0;
    let entropy = 0;
    let numLeft = 0, numRight = 0;
    for (let i = 0; i < NUM_PARTICLES; i++) {
        let particle = particles[i];
        let dx2 = Math.pow(particle.x - averageX, 2),
            dy2 = Math.pow(particle.y - averageY, 2);
        varianceX2 += dx2;
        varianceY2 += dy2;
        varianceVel22 += Math.pow(particle.dx * particle.dx + particle.dy * particle.dy - averageVel2, 2);
        let length = Math.sqrt(dx2 + dy2);
        entropy += length * Math.log(length);
        if (particle.x < averageX) {
            numLeft++;
        } else {
            numRight++;
        }
    }
    entropy /= NUM_PARTICLES;
    varianceX2 /= NUM_PARTICLES;
    varianceY2 /= NUM_PARTICLES;
    varianceVel22 /= NUM_PARTICLES;

    let varianceX = Math.sqrt(varianceX2);
    let varianceY = Math.sqrt(varianceY2);
    let varianceVel2 = Math.sqrt(varianceVel22);

    let varianceLength = Math.sqrt(varianceX2 + varianceY2);
    let varianceVel = Math.sqrt(varianceVel2);
    let averageVel = Math.sqrt(averageVel2);

    // flatRatio = 1 -> perfectly circular
    // flatRatio is high (possibly Infinity) -> extremely horizontally flat
    // flatRatio is low (near 0) -> vertically thin
    let flatRatio = varianceX / varianceY;
    if (varianceY === 0) { flatRatio = 1; }

    // in reset formation, the varianceLength = (sqrt(1/2) - 1/2) * magicNumber * canvasWidth
    // magicNumber is experimentally found to be 1.3938
    // AKA varianceLength = 0.28866 * canvasWidth
    let normalizedVarianceLength = varianceLength / (0.28866 * canvas.width);
    let normalizedAverageVel = averageVel / (canvas.width);
    let normalizedEntropy = entropy / (canvas.width * 1.383870349);

    audioGroup.sourceLfo.frequency.value = flatRatio;
    audioGroup.setFrequency(222 / normalizedEntropy);

    let noiseFreq = 2000 * (Math.pow(8, normalizedVarianceLength) / 8);
    audioGroup.setNoiseFrequency(noiseFreq);

    let groupedUpness = Math.sqrt(averageVel / varianceLength);
    audioGroup.setVolume(Math.max(groupedUpness - 0.05, 0));

    let mouseDistanceToCenter = Math.sqrt(Math.pow(mouseX - averageX, 2) + Math.pow(mouseY - averageY, 2));
    let normalizedMouseDistanceToCenter = mouseDistanceToCenter / Math.sqrt(canvas.width * canvas.height);
    let backgroundVolume = 0.33 / (1 + normalizedMouseDistanceToCenter * normalizedMouseDistanceToCenter);
    audioGroup.setBackgroundVolume(backgroundVolume);

    filter.uniforms.iGlobalTime.value = audioContext.currentTime / 1;
    filter.uniforms.G.value = triangleWaveApprox(audioContext.currentTime / 2) * (groupedUpness + 0.50) * 15000;
    filter.uniforms.iMouseFactor.value = (1 / 15) / (groupedUpness + 1);
    // filter.uniforms['iMouse'].value = new THREE.Vector2(averageX, canvas.height - averageY);

    geometry.verticesNeedUpdate = true;
    composer.render();
}

// 3 orders of fft for triangle wave
function triangleWaveApprox(t: number) {
    return 8 / (Math.PI * Math.PI) * (Math.sin(t) - (1 / 9) * Math.sin(3 * t) + (1 / 25) * Math.sin(5 * t));
}

function touchstart(event: JQuery.Event) {
    // prevent emulated mouse events from occuring
    event.preventDefault();
    let canvasOffset = $(canvas).offset()!;
    let touch = (event.originalEvent as TouchEvent).touches[0];
    let touchX = touch.pageX - canvasOffset.left;
    let touchY = touch.pageY - canvasOffset.top;
    // offset the touchY by its radius so the attractor is above the thumb
    touchY -= 100;

    mouseX = touchX;
    mouseY = touchY;
    enableFirstAttractor(touchX, touchY);
}

function touchmove(event: JQuery.Event) {
    let canvasOffset = $(canvas).offset()!;
    let touch = (event.originalEvent as TouchEvent).touches[0];
    let touchX = touch.pageX - canvasOffset.left;
    let touchY = touch.pageY - canvasOffset.top;
    touchY -= 100;

    mouseX = touchX;
    mouseY = touchY;
    moveFirstAttractor(touchX, touchY);
}

function touchend(event: JQuery.Event) {
    disableFirstAttractor();
}

function mousedown(event: JQuery.Event) {
    if (event.which === 1) {
        mouseX = event.offsetX == undefined ? (event.originalEvent as MouseEvent).layerX : event.offsetX;
        mouseY = event.offsetY == undefined ? (event.originalEvent as MouseEvent).layerY : event.offsetY;
        enableFirstAttractor(mouseX, mouseY);
    }
}

function mousemove(event: JQuery.Event) {
    mouseX = event.offsetX == undefined ? (event.originalEvent as MouseEvent).layerX : event.offsetX;
    mouseY = event.offsetY == undefined ? (event.originalEvent as MouseEvent).layerY : event.offsetY;
    moveFirstAttractor(mouseX, mouseY);
}

function mouseup(event: JQuery.Event) {
    if (event.which === 1) {
        disableFirstAttractor();
    }
}

function enableFirstAttractor(x: number, y: number) {
    let attractor = attractors[0];
    attractor.x = x;
    attractor.y = y;
    attractor.power = 1;
    filter.uniforms.iMouse.value.set(x, renderer.domElement.height - y);
    returnToStartPower = 0;
}

function moveFirstAttractor(x: number, y: number) {
    let attractor = attractors[0];
    attractor.x = x;
    attractor.y = y;
    attractor.mesh.position.set(x, y, 0);
}

function disableFirstAttractor() {
    let attractor = attractors[0];
    attractor.power = 0;
}

function resize(width: number, height: number) {
    camera.right = width;
    camera.bottom = height;
    camera.updateProjectionMatrix();

    filter.uniforms.iResolution.value = new THREE.Vector2(width, height);
}

function instantiatePointCloudAndGeometry() {
    if (pointCloud != null) {
        scene.remove(pointCloud);
    }
    geometry = new THREE.Geometry();
    for (let i = 0; i < NUM_PARTICLES; i++) {
        let particle = particles[i];
        let vertex = new THREE.Vector3(particle.x, particle.y, 0);
        geometry.vertices.push(vertex);
        particles[i].vertex = vertex;
    }

    let starTexture = THREE.ImageUtils.loadTexture("/assets/sketches/line/star.png");
    starTexture.minFilter = THREE.NearestFilter;
    let material = new THREE.PointsMaterial({
        size: 15,
        sizeAttenuation: false,
        map: starTexture,
        opacity: 0.4,
        transparent: true,
    });
    pointCloud = new THREE.Points(geometry, material);
    scene.add(pointCloud);
}

export const Line: ISketch = {
    id: "line",
    init,
    instructions: "Click, drag, look, listen.",
    animate,
    darkTheme: true,
    mousedown,
    mousemove,
    mouseup,
    resize,
    touchstart,
    touchmove,
    touchend,
};
