"""Install private NVIDIA libraries only when Windows has a CUDA GPU."""
from pathlib import Path
import subprocess
import sys

import ctranslate2

if sys.platform == 'win32' and ctranslate2.get_cuda_device_count() > 0:
    print('Installing NVIDIA runtime libraries for local GPU transcription…', flush=True)
    subprocess.run([sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check',
                    '-r', str(Path(__file__).with_name('requirements-gpu.txt'))], check=True)
else:
    print('No Windows CUDA runtime installation needed.', flush=True)
