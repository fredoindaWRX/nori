"""Create a crisp Windows taskbar icon from an approved visual frame."""
from pathlib import Path
import sys

from PIL import Image, ImageEnhance

source = Path(sys.argv[1])
png_output = Path(sys.argv[2])
ico_output = Path(sys.argv[3])

image = Image.open(source).convert("RGBA")
# Keep the black field around the energy globe: it gives the icon a clean edge
# at Windows' smallest taskbar sizes instead of clipping the rings.
image = ImageEnhance.Contrast(image).enhance(1.08)
image = image.resize((512, 512), Image.Resampling.LANCZOS)
png_output.parent.mkdir(parents=True, exist_ok=True)
image.save(png_output, "PNG", optimize=True)
image.save(ico_output, "ICO", sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)])
print(f"Created {png_output} and {ico_output}")
