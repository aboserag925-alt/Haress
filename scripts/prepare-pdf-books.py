"""Build verified local delivery PDFs from the institutional source manifest.
Run: python3 scripts/prepare-pdf-books.py. Requires PyMuPDF. No upload/deploy.
"""
import json,pathlib,hashlib,fitz,shutil,urllib.request
cache=pathlib.Path('/tmp/haress-pdf-originals');cache.mkdir(exist_ok=True)
root=pathlib.Path(__file__).resolve().parents[1];m=json.load(open(root/'content/pdf-source-manifest.json')); out=root/'app/books';out.mkdir(exist_ok=True)
titles={'columbia_aco001785':('منهاج السنة النبوية','المجلدان ١–٢ حسب الفهرس، ليست دعوى اكتمال الكتاب'), 'columbia_aco003751':('صحيح مسلم، الجزء الأول','الجزء الأول، مصر: عيسى البابي الحلبي وشركاه، ١٣٤٩هـ / ١٩٣١م'), 'columbia_aco003752':('صحيح مسلم، الجزء الثاني','الجزء الثاني، مصر: عيسى البابي الحلبي، ١٣٤٩هـ / ١٩٣١م'), 'columbia_aco003165':('صحيح البخاري مع حاشية السندي','المجلدان ١–٢ حسب الفهرس فقط، مجموعة جزئية')}
books=[]
for e in m['entries']:
 original=cache/(e['id']+'.pdf')
 if not original.exists():urllib.request.urlretrieve(e['pdf_lo'],original)
 assert hashlib.sha256(original.read_bytes()).hexdigest()==e['lo_sha256'],e['id']
 doc=fitz.open(original);assert len(doc)==e['lo_pages']; parts=[]; start=0; index=1
 while start<len(doc):
  # Keep full original page images without rasterisation/recompression, under20MB assets limit.
  end=min(start+70,len(doc))
  while True:
   sub=fitz.open();sub.insert_pdf(doc,from_page=start,to_page=end-1);data=sub.tobytes(garbage=4,deflate=True);sub.close()
   if len(data)<20*1024*1024:break
   end=start+max(1,(end-start)//2)
  name=e['id']+'-part-'+str(index)+'.pdf';(out/name).write_bytes(data);parts.append({'file':'/books/'+name,'start':start+1,'end':end,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()});start=end;index+=1
 title,scope=titles[e['id']];books.append({'id':e['id'],'title':title,'scope':scope,'pages':len(doc),'parts':parts,'source':e['aco_page'],'sourceLabel':'NYU Arabic Collections Online / Columbia University Libraries','note':'صور صفحات، بلا بحث نصي. قُسّم الملف إلى أجزاء للعرض دون إعادة تصوير الصفحات.','rights':'تقدير NYU: المواد في الملك العام، مع مسار لطلب الإزالة.','originalSha256':e['lo_sha256']});print(e['id'],len(doc),len(parts),sum(x['bytes'] for x in parts),flush=True)
 doc.close()
(root/'app/books.json').write_text(json.dumps(books,ensure_ascii=False,indent=2))
(root/'content/pdf-source-manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2))
