#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "=================================================="
echo " Starting Student Attendance Payroll System"
echo " (Strict 70% Minimum Attendance Rule Enforced)"
echo "=================================================="

# Check for virtual environment
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
    ./venv/bin/pip install --upgrade pip
    ./venv/bin/pip install -r requirements.txt
fi

echo ""
echo "🚀 Server starting on http://localhost:8000"
echo "👉 Open your web browser and go to: http://localhost:8000"
echo "👉 API Swagger Docs: http://localhost:8000/docs"
echo "Press Ctrl+C to stop the server."
echo ""

./venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload
