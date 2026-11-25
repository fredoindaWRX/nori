from pathlib import Path
script=Path('C:/Nori/streaming/tools/save_hannah_audition.py').read_text(encoding='utf-8')
script=script.replace('Hannah','Jordan').replace('544a4a63-5210-43f2-a711-0d51d77f64ab','bd9e27a1-a7b9-4adc-8bb8-c263b0a56530').replace('9a9cf47702da476aa4629e2506d4a857','79d0bd3e4e5444b18f7b6d89b5927bf1')
exec(compile(script,'save_jordan_audition','exec'))
