"""画像形式・容量・縮小と日本語質問を検証する。"""
import base64
import io
import sys
import unittest
from pathlib import Path
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from photos import prepare_image, questions


def encode(image, fmt='PNG'):
    out = io.BytesIO()
    image.save(out, format=fmt)
    return 'data:image/png;base64,' + base64.b64encode(out.getvalue()).decode()


class PhotosTest(unittest.TestCase):
    def test_resize(self):
        data, original, size = prepare_image(encode(Image.new('RGBA', (2048, 1024), (0, 0, 0, 0))))
        self.assertEqual(original, [2048, 1024])
        self.assertEqual(size, [1024, 512])
        image = Image.open(io.BytesIO(base64.b64decode(data.split(',')[1])))
        self.assertEqual(image.getpixel((0, 0)), (255, 255, 255))
        self.assertFalse(image.getexif())
        self.assertEqual(set(questions()), {'文字情報', '風景'})

    def test_invalid(self):
        for value in ['https://example.com/photo.jpg', 'data:image/png;base64,???',
                      encode(Image.new('RGB', (4, 4)), 'GIF'),
                      encode(Image.new('RGB', (4001, 4000)))]:
            with self.assertRaises(ValueError):
                prepare_image(value)


if __name__ == '__main__':
    unittest.main()
