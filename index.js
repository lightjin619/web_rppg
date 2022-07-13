var player = document.getElementById("toggleStream");
var stopbutton = document.getElementById("Stop");




let curPollFreq = 30;
const SAMPLE_FREQUENCY = 30;
const HPF_CUTOFF = 3;
const LPF_CUTOFF = 0.8;
const iirCalculator = new Fili.CalcCascades();
const bpfCoeffs = iirCalculator.bandpass({
  order: 2,
  characteristic: 'butterworth',
  Fs: 30,
  Fc: LPF_CUTOFF ,
  Fc2: HPF_CUTOFF,
  gain: 0,
  preGain: false,
});

const bpfCoeffs2 = iirCalculator.bandpass({
    order: 2,
    characteristic: 'butterworth',
    Fs: 30,
    Fc: 0.1,
    Fc2: 0.5,
    gain: 0,
    preGain: false,
  });

const bandpassFilter = new Fili.IirFilter(bpfCoeffs);
const bandpassFilter2 = new Fili.IirFilter(bpfCoeffs2);



async function setupCamera() {
    video = document.getElementById('video');
    const stream = await navigator.mediaDevices.getUserMedia({
      'audio': false,
      'video': {
        facingMode: 'user',
        aspectRatio: 1.333,
        width: {ideal: 1280},
      },
    });
    video.srcObject = stream;
  
    return new Promise((resolve) => {
      video.onloadedmetadata = () => {
        resolve(video);
      };
    });
  }


  

  function stop() {
    
    const stream =video.srcObject;
    const tracks = stream.getTracks();
    tracks.forEach(track => {
      track.stop();
    });
  
  }


  
  
  var curFaces;
  // Calls face mesh on the video and outputs the eyes and face bounding boxes to global vars
  async function renderPrediction() {
      const facepred = await fmesh.estimateFaces(canvas);
      ctx.drawImage(video, 0, 0, canvas.width,  canvas.height);

      
  
      if (facepred.length > 0) { // If we find a face, process it  
        curFaces = facepred;
        await drawFaces();
      }

      requestAnimationFrame(renderPrediction);
  };
  
  
  
  // At around 10 Hz for the camera, we want like 5 seconds of history
  var maxHistLen = 300;
  var bloodHist = Array(maxHistLen).fill(0);
  var timingHist = Array(maxHistLen).fill(0);
  var last = performance.now();
  var average = (array) => array.reduce((a, b) => a + b) / array.length;
  var argMax = (array) => array.map((x, i) => [x, i]).reduce((r, a) => (a[0] > r[0] ? a : r))[1];
  let rgbArray =[];
  let sum_red=0;
  let sum_green=0;
  let sum_blue=0;
  var mean_red= [];
  var mean_green= [];
  var mean_blue= [];
  let fpos =[];
  let resp_sig =[];
  let p0;
  let p1;
  let frame0;
  let frame1;
  let st;
  let err;
  let resp_y =0;
  let p1_y;
  let frame=0;



  // Draws the current eyes onto the canvas, directly from video streams
  async function drawFaces(){
    ctx.strokeStyle = "cyan";
    ctx.lineWidth = 2;
    for (face of curFaces){
      if (face.faceInViewConfidence > .90) {
        let mesh = face.scaledMesh;
  
        // Get the facial region of interest's bounds 
        boxLeft = mesh[117][0];
        boxTop = mesh[117][1];
        boxWidth = mesh[346][0] - boxLeft;
        boxHeight = mesh[164][1] - boxTop;
  
        // Draw the box a bit larger for debugging purposes
        ctx.beginPath();
        const boxsize = 6;
        ctx.rect(boxLeft-boxsize, boxTop-boxsize, boxWidth+boxsize*2, boxHeight+boxsize*3);
        ctx.stroke();
        

  
        // Get the image data from that region
        let bloodRegion = ctx.getImageData(boxLeft, boxTop, boxWidth, boxHeight);
        const data = bloodRegion.data;
        for (var i = 0; i < data.length; i+=4) {

          rgbArray.push([data[i], data[i+1], data[i+2]])
        }
       
         // Get the area into Tensorflow, then split it and average the green channel
        for (var i=0; i<rgbArray.length;i++){
          sum_red = sum_red + rgbArray[i][0]
          sum_green = sum_green + rgbArray[i][1]
          sum_blue = sum_blue + rgbArray[i][2]

        }

  
        // Get FPS of this loop as well
        timingHist.push(1/((performance.now() - last)*.001));
        last = performance.now();
  

        
        mean_red.push(sum_red/(boxWidth*boxHeight));
        mean_green.push(sum_green/(boxWidth*boxHeight));
        mean_blue.push(sum_blue/(boxWidth*boxHeight));

        rgbArray=[];
        sum_red=0;
        sum_green=0;
        sum_blue=0;

 
        
        if (mean_red.length> maxHistLen){
          mean_red.shift();
          mean_green.shift();
          mean_blue.shift();
          timingHist.shift();

          frame=frame+1;
          console.log(frame)
          if(frame>30){
            let pos_result = pos(mean_red,mean_green,mean_blue);
            fpos= bandpassFilter.simulate(pos_result)
          
          
            // HR estimation
            var fps =  Math.round(curPollFreq);
            var option = {fftSize: 1024, window: 'hann', _scaling: 'psd'};
            let psd = bci.periodogram(fpos, fps, option);
            let freq=psd.frequencies;
            let pxx = psd.estimates;
            updateChart(timingHist,freq,pxx);
            updateChart2(fpos);
            frame = 0;
          }
        }
      }
    }
  }
  
  
  
  var heartrate = 0;
  function updateChart(times, freq, data){
    // Get the bin frequencies from their index
    data = data.map(elem => Math.abs(elem));
    curPollFreq = average(times.slice(Math.round(maxHistLen/2)));
    binNumber = Array.from(data).map((elem, index) => index+1);
    binHz = binNumber.map(elem => elem*curPollFreq/maxHistLen);

    let index_07 = math.round(0.8/(15/513));
    let index_4 = math.round(4/(15/513));
    let max = Math.max(...data.slice(index_07,index_4));
    let maxloc = data.indexOf(max);
    maxHz = freq[maxloc];
  
  
    
    document.getElementById('HR_indicator').innerHTML = "Predicted heartrate: " + Math.round(maxHz*60) + " BPM";
    document.getElementById("cameraFPS").innerHTML = "Camera Average FPS: " + Math.round(curPollFreq);
  
  
    power = Array.from(data).map((elem, index) => [freq[index]*60, elem]);
  
    new Dygraph(document.getElementById("graphdiv"),
                power,
                {
                  labels: ["Bin", "Magnitude"],
                  title: "Heartrates vs Magnitude",
                  // xlabel: "Frequency (Hz)",
                  // ylabel: "Magnitude",
                  dateWindow: [30, 250]
                });
    }
  

  function updateChart2(data){
    
    indexedData = Array.from(data).map((elem, index) => [index+1, elem])
  
    new Dygraph(document.getElementById("graphdiv2"),
                indexedData,
                {
                  labels: ["Index", "Pixel Intensity"],
                  // ylabel: "Avg'd Pixel Intensity",
                  // xlabel: "Time"
                  title: "Pixel Average vs. Time"
  
                });
  }


  var canvas;
  var ctx;

  async function main() {
      fmesh = await facemesh.load({maxFaces:1});
  
      // Set up front-facing camera
      await setupCamera();


      videoWidth = video.videoWidth;
      videoHeight = video.videoHeight;
 

      video.play()
      
      // Create canvas and drawing context
      canvas = document.getElementById('facecanvas');
      canvas.width = videoWidth/2;
      canvas.height = videoHeight/2;
      ctx = canvas.getContext('2d');



  
  
      // start prediction loop
      renderPrediction();
  }
  
  
  let H=[];
  let win_red =[];
  let win_green =[];
  let win_blue =[];




  function pos(red,green,blue){

    let vred = nj.array([red]);
    let vgreen = nj.array([green]);
    let vblue = nj.array([blue]);
  
  
    let C = [red,green,blue];

    let mean_red = vred.mean();
    let mean_green = vgreen.mean();
    let mean_blue = vblue.mean();
    let mean_color = nj.array([mean_red, mean_green, mean_blue]);
  
    let a= [[1,2],[3,4]];
  
    let diag_mean_color = nj.diag(mean_color);
    let b=[[diag_mean_color.selection.data[0],diag_mean_color.selection.data[1],diag_mean_color.selection.data[2]], 
    [diag_mean_color.selection.data[3],diag_mean_color.selection.data[4],diag_mean_color.selection.data[5]],
    [diag_mean_color.selection.data[6],diag_mean_color.selection.data[7],diag_mean_color.selection.data[8]]]
    
    let diag_mean_color_inv = math.inv(b);
    
  
    
    let Cn=multiply(diag_mean_color_inv, C);
  
    
    for(var i=0; i<C.length; i++){
      Cn[0][i]=Cn[0][i]-1;
      Cn[1][i]=Cn[1][i]-1;
      Cn[2][i]=Cn[2][i]-1;
    }
  
  
    
    let projection_matrix = [[0,1,-1],[-2,1,1]];
    let S=multiply(projection_matrix,Cn);
  
   
   
  
    let std = [1, math.std(S[0])/math.std(S[1])];
  
    //console.log(std,S)
    let P = math.multiply(std,S);
    for(var i=0; i<P.length; i++){
        H[i] = (P[i]-math.mean(P))/math.std(P);
        
             
    }
    
    
    return H
  
  
  
  
  }    

  
function multiply (a, b) {
  const transpose = (a) => a[0].map((x, i) => a.map((y) => y[i]));
  const dotproduct = (a, b) => a.map((x, i) => a[i] * b[i]).reduce((m, n) => m + n);
  const result = (a, b) => a.map((x) => transpose(b).map((y) => dotproduct(x, y)));
  return result(a, b);
}