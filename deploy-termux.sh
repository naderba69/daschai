#!/bin/bash
# ===============================================================================
# OX-Alpha Workbench Pro - Termux GitHub Quick Deploy Script (v2 — Secured)
# ===============================================================================
set -e
echo "=================================================="
echo "🚀 OX-Alpha Workbench Pro — Termux Deployer v2"
echo "=================================================="
# 1. Check dependencies
if ! command -v git &> /dev/null; then
  echo "📦 Installing git & nodejs..."
  pkg update -y && pkg install git nodejs -y
fi
# 2. Ask for repository URL with validation
read -p "🔗 GitHub repo URL (e.g. https://github.com/naderba69/daschai.git): " REPO_URL
if [ -z "$REPO_URL" ]; then echo "❌ Error: URL empty."; exit 1; fi
if ! echo "$REPO_URL" | grep -qE "github\.com[:/].+\/.+"; then echo "❌ Invalid GitHub URL."; exit 1; fi
# Confirm before destructive operation
if [ -d .git ]; then
  echo "⚠️  Existing .git found — will be re-initialized."
  read -p "Continue? (y/N): " CONFIRM
  if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then echo "Cancelled."; exit 0; fi
  cp -r .git .git.bak.$(date +%s) 2>/dev/null || true
  rm -rf .git
fi
# 3. Build before commit
if [ -f build.js ]; then echo "🔨 Building..."; node build.js --minify || node build.js; fi
# 4. Git init & push
git init
git branch -M main
git add .
git commit -m "feat: OX-Alpha Pro v2 — audited & secured" || echo "Nothing to commit"
git remote add origin "$REPO_URL" 2>/dev/null || git remote set-url origin "$REPO_URL"
echo "⬆️ Pushing to $REPO_URL ..."
git push -u origin main --force
echo "✅ Done! Now import repo at https://vercel.com/new"
