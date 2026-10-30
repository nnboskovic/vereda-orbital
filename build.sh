#!/usr/bin/env bash
# Compiles the Orbital shader for Qt Quick (OpenGL 3.3 / GLES 3.0): the scene, and the
# lightning variant built from the same source with -DFLASH.
set -euo pipefail
cd "$(dirname "$0")/shader"
/usr/lib/qt6/bin/qsb --glsl "330,300 es" --qt6 -o orbital.frag.qsb orbital.frag
/usr/lib/qt6/bin/qsb --glsl "330,300 es" --qt6 -DFLASH -o flash.frag.qsb orbital.frag
echo "built shader/orbital.frag.qsb and shader/flash.frag.qsb"
