"""Compile and execute the production acquisition/protocol headers on the host."""
from pathlib import Path
import argparse
import os
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--cxx', default=os.environ.get('CXX', 'c++'))
parser.add_argument('--zig', action='store_true', help='Use zig c++ as the compiler')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
out = root / 'test-output'
out.mkdir(exist_ok=True)
exe = out / ('acquisition-tests.exe' if os.name == 'nt' else 'acquisition-tests')
command = [args.cxx] + (['c++'] if args.zig else [])
command += ['-std=c++11', '-Wall', '-Wextra', '-Werror', '-I', str(root/'include'), str(root/'tests/acquisition.cpp'), '-o', str(exe)]
subprocess.run(command, check=True)
subprocess.run([str(exe)], check=True)
