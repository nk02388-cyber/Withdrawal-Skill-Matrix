export function photoFileError(file){
 if(!file)return '';
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))return 'เลือกรูป JPG, PNG หรือ WebP';
 if(file.size<=0||file.size>10*1024*1024)return 'รูปต้องมีขนาดไม่เกิน 10 MB';
 return '';
}
export async function prepareStaffPhoto(file){
 if(!file)return null;
 const error=photoFileError(file);if(error)throw new Error(error);
 let bitmap;try{bitmap=await createImageBitmap(file);}catch{throw new Error('เปิดรูปไม่ได้ กรุณาเลือกรูปอื่น');}
 try{
 const ratio=Math.min(1,384/Math.max(bitmap.width,bitmap.height));
 const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
 const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
 for(const quality of [.85,.7,.5]){const data=canvas.toDataURL('image/jpeg',quality);if(data.length<=100000)return data;}
 throw new Error('รูปมีขนาดใหญ่เกินไป กรุณาเลือกรูปอื่น');
 }finally{bitmap.close();}
}
