import {convert} from './engine.js';
self.onmessage=({data})=>{try{const result=convert(data);self.postMessage({id:data.id,result},result.preprocessed?[result.preprocessed.data.buffer]:[]);}catch(e){self.postMessage({id:data.id,error:e.message});}};
