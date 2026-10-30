"""Averages an image down to an exact size (box filter): resize.py in.png out.png width height"""
import sys
from PIL import Image

src, dst, w, h = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
Image.open(src).convert("RGB").resize((w, h), Image.BOX).save(dst)
