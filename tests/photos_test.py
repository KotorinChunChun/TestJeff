"""画像形式・容量・縮小と日本語質問を検証する。"""
import base64
import io
import sys
import unittest
import tempfile
from pydantic import ValidationError
from pathlib import Path
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from photos import prepare_image, questions, PhotoInput, PhotoPrompts, PhotoSamples, PhotoFailure


def encode(image, fmt='PNG'):
    out = io.BytesIO()
    image.save(out, format=fmt)
    return 'data:image/png;base64,' + base64.b64encode(out.getvalue()).decode()


class PhotosTest(unittest.TestCase):
    def test_failure_parameters_compatible(self):
        old=PhotoFailure(mode='photos',model='qwen-2b',filename='写真.png',error='対象外')
        self.assertIsNone(old.parameters)
        params={'connection':{'mode':'fds','device':'cpu'},'prompts':{'text':'文字の指示'},'threshold':.5}
        current=PhotoFailure.model_validate({**old.model_dump(),'parameters':params})
        self.assertEqual(current.model_dump()['parameters'],params)

    def test_resize(self):
        data, original, size = prepare_image(encode(Image.new('RGBA', (2048, 1024), (0, 0, 0, 0))))
        self.assertEqual(original, [2048, 1024])
        self.assertEqual(size, [1024, 512])
        image = Image.open(io.BytesIO(base64.b64decode(data.split(',')[1])))
        self.assertEqual(image.getpixel((0, 0)), (255, 255, 255))
        self.assertFalse(image.getexif())
        self.assertEqual(set(questions()), {'文字情報', '風景', '看板面積', '白黒'})

    def test_prompts_and_source(self):
        with self.assertRaises(ValidationError):
            PhotoPrompts(text=' ')
        with self.assertRaises(ValidationError):
            PhotoInput(model='qwen-2b')
        with self.assertRaises(ValidationError):
            PhotoInput(model='qwen-2b', image='x', sample_id='a'*64)
        with self.assertRaises(ValidationError):
            PhotoInput(model='qwen-2b', sample_id='../sample1.jpg')
        custom = PhotoPrompts(coverage='日本語の変更した指示')
        self.assertIn(custom.coverage, questions(custom)['看板面積']['instructions'])
        self.assertEqual(len(questions()['看板面積']['criteria']), 11)

    def test_samples_persistence(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1] / 'dev/testing/output') as folder:
            root = Path(folder)
            source = root / 'image'
            source.mkdir()
            Image.new('RGB', (10, 10)).save(source / '写真.png')
            store = PhotoSamples(source, root / 'results')
            ident = store.listing()[0]['id']
            name, digest, image = store.get(ident)
            self.assertEqual(name, '写真.png')
            prepare_image(image)
            store.save(ident, {'sha256':digest, 'coverage_percent':20})
            self.assertEqual(PhotoSamples(source, root / 'results').listing()[0]['result']['coverage_percent'], 20)
            Image.new('RGB', (20, 20)).save(source / '写真.png')
            self.assertIsNone(store.listing()[0]['result'])
            with self.assertRaises(ValueError):
                store.get('../写真.png')

    def test_invalid(self):
        for value in ['https://example.com/photo.jpg', 'data:image/png;base64,???',
                      encode(Image.new('RGB', (4, 4)), 'GIF'),
                      encode(Image.new('RGB', (4001, 4000)))]:
            with self.assertRaises(ValueError):
                prepare_image(value)


if __name__ == '__main__':
    unittest.main()

