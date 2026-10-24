"""Export the actual mobile-viewport recording with a factual side caption."""
from pathlib import Path
import json
import re
import subprocess

root = Path(__file__).resolve().parent.parent
folder = root / 'artifacts/meeting-success'
evidence = json.loads((folder / 'creation-evidence.json').read_text())
task = evidence['task']
assert task['status'] == 'succeeded'
code = task['result']['meetingCode']
formatted = ' '.join(code[i:i+3] for i in range(0, len(code), 3))
left = folder / 'left.txt'
right = folder / 'right.txt'
left.write_text('龙虾脑 · 腾讯会议\n\n在手机网页输入\n创建一个腾讯会议\n\n电脑执行创建操作\n页面显示进度与结果\n\n2026 年 10 月 21 日\n实际浏览器录屏')
right.write_text(f'本次实际结果\n\n会议已创建\n{formatted}\n\n任务耗时约 7 秒\n\n录制范围\n430 × 932 手机视口\n使用本机浏览器模拟\n\n麦克风与摄像头状态\n仍需在电脑上检查')
ffmpeg = root / '.tooling/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1'
font = '/System/Library/Fonts/STHeiti Light.ttc'
filters = (
    'scale=430:932:in_range=pc:out_range=tv,'
    'pad=1440:1000:505:34:color=0xf7f8f5,'
    f"drawtext=fontfile='{font}':textfile='{left}':fontsize=25:line_spacing=16:fontcolor=0x23493b:x=60:y=160,"
    f"drawtext=fontfile='{font}':textfile='{right}':fontsize=24:line_spacing=16:fontcolor=0x23493b:x=990:y=160"
)
target = root / 'artifacts/腾讯会议自动创建.mp4'
subprocess.run([str(ffmpeg), '-y', '-i', str(folder / '腾讯会议创建录屏.webm'), '-vf', filters,
    '-an', '-r', '25', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-color_range', 'tv', '-movflags', '+faststart', str(target)], check=True, capture_output=True)
decoded = subprocess.run([str(ffmpeg), '-v', 'error', '-i', str(target), '-f', 'null', '-'], check=True, capture_output=True)
assert not decoded.stderr, decoded.stderr.decode()
metadata = subprocess.run([str(ffmpeg), '-i', str(target)], capture_output=True).stderr.decode()
duration = re.search(r'Duration: ([\d:.]+)', metadata).group(1)
subprocess.run([str(ffmpeg), '-y', '-ss', '16', '-i', str(target), '-frames:v', '1',
    str(folder / 'video-result-frame.png')], check=True, capture_output=True)
(folder / 'video-validation.json').write_text(json.dumps({
    'file': target.name, 'duration': duration, 'resolution': '1440×1000',
    'fps': 25, 'codec': 'H.264', 'audio': False, 'fullDecodePassed': True,
    'taskId': task['id'], 'sourceRecording': '腾讯会议创建录屏.webm'
}, ensure_ascii=False, indent=2))
print(f'{target.name}: {duration}; full decode passed')
