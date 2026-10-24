"""Package source, final deliverables and evidence; omit browser/runtime caches."""
from pathlib import Path
import os
import stat
import zipfile

root=Path(__file__).resolve().parent.parent
target=root/'龙虾脑Demo交付.zip'
selected=set()
for name in ['.gitignore','README.md','package.json','server.mjs','start.sh','启动龙虾脑.command','data/tasks.json']:
    selected.add(root/name)
for folder in ['lib','public','tests','scripts']:
    selected.update(p for p in (root/folder).rglob('*') if p.is_file())
selected.update(p for p in (root/'docs').glob('*') if p.is_file())
for folder in ['artifacts/acceptance','artifacts/meeting-update','artifacts/meeting-success','artifacts/bilibili-update']:
    selected.update(p for p in (root/folder).glob('*') if p.suffix in ['.json','.png'])
for name in ['artifacts/龙虾脑演示.mp4','artifacts/腾讯会议权限反馈.mp4','artifacts/腾讯会议自动创建.mp4','artifacts/recording/recording-evidence.json']:
    selected.add(root/name)
for folder in (root/'artifacts').iterdir():
    if folder.is_dir() and len(folder.name)==36:
        selected.update(p for p in folder.glob('*') if p.suffix in ['.json','.png'])
selected.update(p for p in (root/'.tooling/龙虾脑会议执行器.app').rglob('*') if p.is_file())
selected.add(root/'.tooling/meeting-native')
temporary=target.with_suffix('.tmp.zip')
with zipfile.ZipFile(temporary,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
    for p in sorted(selected):
        name='龙虾脑Demo/'+str(p.relative_to(root))
        if p.is_symlink():
            info=zipfile.ZipInfo(name);info.create_system=3
            info.external_attr=(stat.S_IFLNK|0o777)<<16
            archive.writestr(info,os.readlink(p))
        elif p.is_file():
            archive.write(p,name)
with zipfile.ZipFile(temporary) as archive:
    assert archive.testzip() is None
    assert archive.read('龙虾脑Demo/.tooling/meeting-native').decode()=='龙虾脑会议执行器.app/Contents/MacOS/meeting-native'
    count=len(archive.namelist())
temporary.replace(target)
print(f'{target.name}: {count} files, {target.stat().st_size/1024/1024:.2f} MiB, integrity OK')
