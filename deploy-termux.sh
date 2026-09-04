#!/bin/bash
# ==============================================================================
# OX-Alpha Workbench Pro - Termux GitHub Quick Deploy Script
# ==============================================================================

echo "=================================================="
echo "🚀 OX-Alpha Workbench Pro - Termux GitHub Deployer"
echo "=================================================="

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo "📦 Installing git in Termux..."
    pkg update -y && pkg install git -y
fi

# Ask for repository URL
read -p "🔗 Enter your GitHub Repository URL (e.g. https://github.com/username/ox-alpha.git): " REPO_URL

if [ -z "$REPO_URL" ]; then
    echo "❌ Error: Repository URL cannot be empty."
    exit 1
fi

echo "⚙️ Initializing Git repository..."
rm -rf .git
git init
git branch -M main

echo "📁 Staging project files..."
git add .

echo "💾 Committing files..."
git commit -m "Initial Release: OX-Alpha Workbench Pro (Production Ready)"

echo "🔗 Setting remote origin..."
git remote add origin "$REPO_URL"

echo "⬆️ Pushing to GitHub..."
git push -u origin main --force

echo ""
echo "=================================================="
echo "✅ Successfully pushed to GitHub!"
echo "🌐 Now go to https://vercel.com/new and import your repo to deploy."
echo "=================================================="
