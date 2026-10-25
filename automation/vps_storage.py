"""Clean expendable caches and alert on root filesystem capacity."""
import argparse
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / 'runtime' / 'vps_storage_alert.json'
PROFILES = ('valuation-perf-chrome', 'valuation-lcp-browser',
            'stock-lcp-chromium', 'stock-history-chromium',
            'valuation-lcp-browser-current')


def clean() -> None:
    cutoff = time.time() - 7 * 86400
    for folder in ('/var/lib/snapd/cache', '/var/cache/apt/archives'):
        for path in Path(folder).glob('*'):
            if folder == '/var/cache/apt/archives' and path.suffix != '.deb':
                continue
            if not path.is_symlink() and path.is_file() and path.stat().st_mtime < cutoff:
                path.unlink()
                print(f'Removed cache: {path}', flush=True)
    processes = subprocess.check_output(['ps', '-eo', 'comm='], text=True)
    if any('chrom' in name.lower() for name in processes.splitlines()):
        print('Browser running; temporary profiles retained', flush=True)
        return
    for name in PROFILES:
        path = Path('/tmp/snap-private-tmp/snap.chromium/tmp') / name
        if not path.is_dir() or path.is_symlink():
            continue
        newest = path.stat().st_mtime
        for directory, _, files in os.walk(path):
            newest = max(newest, Path(directory).stat().st_mtime)
            for filename in files:
                try:
                    newest = max(newest, (Path(directory) / filename).lstat().st_mtime)
                except FileNotFoundError:
                    pass
        if newest < cutoff:
            shutil.rmtree(path)
            print(f'Removed inactive profile: {path}', flush=True)


def notify(message: str) -> None:
    from dotenv import dotenv_values
    import requests

    config = dotenv_values(ROOT / '.telegram_uptime.env')
    token = config.get('TELEGRAM_BOT_TOKEN')
    chat = config.get('TELEGRAM_CHAT_ID')
    if not token or not chat:
        raise RuntimeError('Telegram disk alert configuration missing')
    try:
        response = requests.post(
            f'https://api.telegram.org/bot{token}/sendMessage',
            data={'chat_id': chat, 'text': message}, timeout=20,
        )
        success = response.status_code == 200 and response.json().get('ok') is True
    except (requests.RequestException, ValueError):
        raise RuntimeError('Telegram disk alert delivery failed') from None
    if not success:
        raise RuntimeError('Telegram disk alert rejected')


def monitor() -> None:
    stats = os.statvfs('/')
    used = (stats.f_blocks - stats.f_bfree) * stats.f_frsize
    available = stats.f_bavail * stats.f_frsize
    percent = used * 100 / (used + available)
    level = 90 if percent >= 90 else 80 if percent >= 80 else 0
    print(f'Root disk: {percent:.1f}% used, {available / 1024**3:.2f} GiB available', flush=True)
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    now = time.time()
    if level != state.get('level', 0) or (level and now - state.get('sent_at', 0) >= 86400):
        label = 'KHẨN' if level == 90 else 'CẢNH BÁO' if level else 'ĐÃ PHỤC HỒI'
        notify(f'[{label}] Dung lượng VPS {os.uname().nodename}\n'
               f'Ổ / dùng {percent:.1f}%, còn {available / 1024**3:.2f} GiB.\n'
               'Ngưỡng cảnh báo: 80% / 90%.')
        state = {'level': level, 'sent_at': now}
    STATE.parent.mkdir(parents=True, exist_ok=True)
    temporary = STATE.with_suffix('.tmp')
    temporary.write_text(json.dumps(state))
    temporary.replace(STATE)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('clean', 'monitor'))
    args = parser.parse_args()
    clean() if args.action == 'clean' else monitor()
