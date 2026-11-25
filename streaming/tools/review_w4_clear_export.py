from pathlib import Path
script=Path('C:/Nori/streaming/tools/review_w3_clear_export.py').read_text(encoding='utf-8')
script=script.replace('Week-3/W3-MAIN','Week-4/W4-MAIN').replace('Nori-One-Task-Three-Checks-Ethan.mp4','Nori-Where-Is-The-Actual-Work-Jordan.mp4').replace('[172,182,188]','[202,212,221]')
exec(compile(script,'review_w4_clear_export','exec'))
