"""Copy a recording session without modifying the source; verify every file."""
import argparse, hashlib, json, os, pathlib, shutil, time, zipfile

def write_json(path, data):
    path = pathlib.Path(path)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(temp, path)

def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--video-dir', required=True)
    parser.add_argument('--fit-zip', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    source = pathlib.Path(args.video_dir).resolve()
    archive = pathlib.Path(args.fit_zip).resolve()
    dest = pathlib.Path(args.output).resolve()
    if dest == source or dest.is_relative_to(source):
        raise ValueError('The working folder must be outside the original video folder.')
    if not source.is_dir() or not archive.is_file():
        raise ValueError('The video folder or FIT/ZIP file was not found.')
    dest.mkdir(parents=True, exist_ok=True)
    files = [(archive, pathlib.Path('originals/fit') / archive.name)]
    files += [(p, pathlib.Path('originals/video') / p.relative_to(source)) for p in sorted(source.rglob('*')) if p.is_file()]
    total = sum(p.stat().st_size for p, _ in files)
    progress = {'status': 'copying', 'totalBytes': total, 'copiedBytes': 0, 'files': [], 'rotation': 180}
    started = time.monotonic()
    for src, rel in files:
        target = dest / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        size = src.stat().st_size
        progress.update(currentFile=src.name, currentBytes=0, currentSize=size)
        digest = hashlib.sha256()
        if not target.exists():
            partial = target.with_suffix(target.suffix + '.partial')
            with open(src, 'rb') as inp, open(partial, 'wb') as out:
                last = 0
                for block in iter(lambda: inp.read(8 * 1024 * 1024), b''):
                    digest.update(block)
                    out.write(block)
                    progress['currentBytes'] += len(block)
                    if time.monotonic() - last > 3:
                        progress['elapsedSeconds'] = round(time.monotonic() - started)
                        write_json(dest / 'import-progress.json', progress)
                        last = time.monotonic()
            shutil.copystat(src, partial)
            progress['status'] = 'verifying'
            write_json(dest / 'import-progress.json', progress)
            source_hash = digest.hexdigest()
            if sha256(partial) != source_hash:
                raise RuntimeError('Copy hash mismatch: ' + str(src))
            os.replace(partial, target)
        else:
            if target.stat().st_size != size:
                raise RuntimeError('Existing destination differs: ' + str(target))
            source_hash = sha256(src)
            if sha256(target) != source_hash:
                raise RuntimeError('Existing destination hash differs: ' + str(target))
        progress['files'].append({'source': str(src), 'path': rel.as_posix(), 'bytes': size, 'sha256': source_hash, 'verified': True})
        progress['copiedBytes'] += size
        progress['status'] = 'copying'
        write_json(dest / 'import-progress.json', progress)
        print('VERIFIED', src.name, size, flush=True)
    fit_dir = dest / 'fit'
    fit_dir.mkdir(exist_ok=True)
    if archive.suffix.lower() == '.fit':
        shutil.copy2(dest / files[0][1], fit_dir / archive.name)
        progress.update(status='complete', elapsedSeconds=round(time.monotonic()-started))
        write_json(dest / 'import-progress.json', progress)
        write_json(dest / 'session-manifest.json', progress)
        return
    with zipfile.ZipFile(dest / files[0][1]) as z:
        for item in z.infolist():
            if item.is_dir(): continue
            output = (fit_dir / item.filename).resolve()
            if not output.is_relative_to(fit_dir.resolve()):
                raise ValueError('Unsafe ZIP path')
            output.parent.mkdir(parents=True, exist_ok=True)
            with z.open(item) as inp, open(output, 'wb') as out: shutil.copyfileobj(inp, out)
    progress.update(status='complete', elapsedSeconds=round(time.monotonic() - started))
    write_json(dest / 'import-progress.json', progress)
    write_json(dest / 'session-manifest.json', progress)

if __name__ == '__main__': main()
