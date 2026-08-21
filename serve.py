# -*- coding: utf-8 -*-
"""serve.py — 局域网启动器：手机和电脑用同一个地址访问康复AI。
用法:  python serve.py  （默认 8000 端口）
启动后访问 http://127.0.0.1:8000 （本机）或 http://<本机IP>:8000 （同一Wi-Fi的手机）
注意：手机用摄像头需要 HTTPS，局域网 http 下只能用「图片分析」和记录功能。
      要手机也能实时摄像头，把本文件夹拖到 https://app.netlify.com/drop 部署即可。
"""
import http.server
import socket
import socketserver
import sys

# Windows 控制台默认 cp1252，打印中文会崩 —— 统一输出 UTF-8
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
DIRECTORY = __file__ and '.'


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # 允许同网段设备访问摄像头所需的安全上下文提示（实际摄像头仍需 HTTPS）
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *a):
        pass


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        return s.getsockname()[0]
    except OSError:
        return '127.0.0.1'
    finally:
        s.close()


class Threaded(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


if __name__ == '__main__':
    ip = lan_ip()
    print('=' * 46)
    print('  Rehab AI (Kangfu AI) - Stick-figure posture analysis')
    print('  This PC:  http://127.0.0.1:%d' % PORT)
    print('  Phone:    http://%s:%d  (same Wi-Fi)' % (ip, PORT))
    print('  Phone camera needs HTTPS: deploy to Netlify (see README)')
    print('  Press Ctrl+C to stop')
    print('=' * 46)
    with Threaded(('0.0.0.0', PORT), Handler) as httpd:
        httpd.serve_forever()
