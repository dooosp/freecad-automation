#!/usr/bin/env bash
set -u

echo "timestamp_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "github_workflow=${GITHUB_WORKFLOW:-unknown}"
echo "github_run_id=${GITHUB_RUN_ID:-unknown}"
echo "github_sha=${GITHUB_SHA:-unknown}"
echo "github_ref=${GITHUB_REF:-unknown}"
echo "github_event_name=${GITHUB_EVENT_NAME:-unknown}"
echo "runner_os=${RUNNER_OS:-unknown}"
echo "runner_name=${RUNNER_NAME:-unknown}"
echo "runner_arch=${RUNNER_ARCH:-unknown}"
echo "pwd=${PWD}"
echo "uname=$(uname -a 2>/dev/null || echo unavailable)"

if command -v node >/dev/null 2>&1; then
  echo "node_version=$(node --version)"
else
  echo "node_version=missing"
fi

if command -v npm >/dev/null 2>&1; then
  echo "npm_version=$(npm --version)"
else
  echo "npm_version=missing"
fi

if command -v python >/dev/null 2>&1; then
  echo "python_version=$(python --version 2>&1)"
elif command -v python3 >/dev/null 2>&1; then
  echo "python_version=$(python3 --version 2>&1)"
else
  echo "python_version=missing"
fi

if command -v pip >/dev/null 2>&1; then
  echo "pip_version=$(pip --version)"
else
  echo "pip_version=missing"
fi

if command -v wslpath >/dev/null 2>&1; then
  echo "wslpath=available"
else
  echo "wslpath=missing"
fi

for var in FREECAD_APP FREECAD_BIN FREECAD_CMD FREECAD_PYTHON FREECAD_DIR; do
  eval "value=\${$var:-}"
  if [ -n "${value}" ]; then
    echo "${var}=${value}"
  else
    echo "${var}=unset"
  fi
done

if [ -d "/Applications/FreeCAD.app" ]; then
  echo "freecad_macos_bundle=present"
else
  echo "freecad_macos_bundle=missing"
fi

if command -v FreeCADCmd >/dev/null 2>&1; then
  echo "freecadcmd_upper=$(command -v FreeCADCmd)"
else
  echo "freecadcmd_upper=missing"
fi

if command -v freecadcmd >/dev/null 2>&1; then
  echo "freecadcmd_lower=$(command -v freecadcmd)"
else
  echo "freecadcmd_lower=missing"
fi
