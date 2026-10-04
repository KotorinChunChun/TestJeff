"""二軸分類とSQLiteサムネイルの永続化を検証。"""
import base64
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from image_store import ImageStore, classification_questions, TYPES, CONTENTS

class StoreTest(unittest.TestCase):
    def test_axes(self):
        q=classification_questions()
        self.assertEqual(set(q['image_type']['criteria']),set(TYPES))
        self.assertEqual(set(q['primary_content']['criteria']),set(CONTENTS))
        self.assertIn('document_form_receipt',q['primary_content']['criteria'])
        self.assertEqual(len(TYPES),9)

    def test_blob_and_history(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1]/'dev/testing/output') as folder:
            path=Path(folder)/'images.sqlite3'
            stream=io.BytesIO();Image.new('RGB',(1000,500),'green').save(stream,format='JPEG')
            picture='data:image/jpeg;base64,'+base64.b64encode(stream.getvalue()).decode()
            result={'created_at':'2026-10-04','model':'test','image_type':'photo_realistic','primary_content':'photo_plant','source_size':[1000,500],'file_size_bytes':123456,'is_monochrome':False,'monochrome_probability':0.1}
            store=ImageStore(path);ident=store.save('classification','写真.jpg',picture,result)
            self.assertEqual(store.history('photos'),[])
            rows=ImageStore(path).history('classification')
            self.assertEqual(rows[0]['result'],result)
            thumb=Image.open(io.BytesIO(base64.b64decode(rows[0]['image'].split(',')[1])))
            self.assertEqual(thumb.size,(240,120))
            with store.connect() as db:
                self.assertEqual(db.execute('select typeof(thumbnail) from image_results').fetchone()[0],'blob')
                self.assertEqual(db.execute('select source_width,source_height,file_size_bytes,is_monochrome,monochrome_probability from image_results').fetchone(),(1000,500,123456,0,0.1))
            self.assertEqual(store.history('classification',ident),[])
            store.save('classification','破損.png',None,{'created_at':'2026-10-04','model':'test','error':'画像を読み込めません'})
            failure=store.history('classification')[0]
            self.assertIsNone(failure['image'])
            self.assertIn('error',failure['result'])

if __name__=='__main__':unittest.main()
