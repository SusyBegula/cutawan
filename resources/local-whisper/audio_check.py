"""Exercise local audio decoding without loading a speech model or using AI."""
import io
import os
from pathlib import Path
import sys
import wave

_dll_handles = []
_dll_directories = set()


def prepare_windows_cuda():
    """Keep private NVIDIA DLL directories available throughout transcription."""
    if sys.platform != 'win32':
        return
    for entry in sys.path:
        for directory in (Path(entry) / 'nvidia').glob('*/bin'):
            if directory in _dll_directories:
                continue
            _dll_handles.append(os.add_dll_directory(str(directory)))
            _dll_directories.add(directory)
            os.environ['PATH'] = str(directory) + os.pathsep + os.environ.get('PATH', '')


def verify_audio_decoder():
    prepare_windows_cuda()
    from faster_whisper import decode_audio

    with io.BytesIO() as audio:
        with wave.open(audio, 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(b'\0\0' * 1600)
        audio.seek(0)
        try:
            samples = decode_audio(audio, sampling_rate=16000)
        except TypeError as error:
            if 'metadata_errors' not in str(error):
                raise
            raise RuntimeError(
                'Local Whisper audio packages are incompatible. Reinstall local Whisper '
                'from Settings to install compatible faster-whisper and PyAV versions.'
            ) from error
        if len(samples) != 1600:
            raise RuntimeError('Local Whisper could not correctly decode the test audio. Reinstall it from Settings.')
    if sys.platform == 'win32':
        import ctranslate2
        if ctranslate2.get_cuda_device_count() > 0:
            import ctypes
            try:
                ctypes.WinDLL('cublas64_12.dll')
                ctypes.WinDLL('cudnn64_9.dll')
            except OSError as error:
                raise RuntimeError(
                    'Local Whisper detected an NVIDIA GPU but its CUDA runtime is missing. '
                    'Reinstall local Whisper from Settings to install the private GPU libraries.'
                ) from error


if __name__ == '__main__':
    verify_audio_decoder()
    print('Local audio decoder is ready.')
