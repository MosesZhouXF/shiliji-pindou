import {convert} from './engine.js';
self.onmessage=({data})=>{try{self.postMessage({id:data.id,result:convert(data)});}catch(e){self.postMessage({id:data.id,error:e.message});}};
