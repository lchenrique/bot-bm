#!/bin/bash
# Script para otimizar ambiente Render para Playwright com 512MB RAM

echo "🔧 Aplicando otimizações de memória..."

# Definir limites de memória do Node.js
export NODE_OPTIONS="--max-old-space-size=384 --max-semi-space-size=32"

# Limpar cache antes de iniciar
echo "🧹 Limpando caches..."
rm -rf /tmp/.playwright* 2>/dev/null || true
rm -rf ~/.cache/ms-playwright 2>/dev/null || true

echo "✅ Otimizações aplicadas!"
echo "Memória disponível:"
free -h

# Iniciar aplicação
exec "$@"
