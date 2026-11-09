// Classic worker keeps the OpenCV UMD runtime isolated from the main page.
importScripts('./vendor/opencv.js');
const ready=Promise.all([self.cv,import('./flat.js')]);
self.onmessage=async({data})=>{
  try{const [cv,{convertFlat}]=await ready,result=convertFlat(data,cv);self.postMessage({id:data.id,result},result.preprocessed?[result.preprocessed.data.buffer]:[]);}
  catch(e){self.postMessage({id:data.id,error:typeof e==='number'?'图像处理失败，请降低格数后重试':e.message});}
};
