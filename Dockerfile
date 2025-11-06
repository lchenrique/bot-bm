# Usa a imagem base do Playwright
FROM mcr.microsoft.com/playwright:v1.50.1-jammy

# Atualiza pacotes do sistema e instala dependências necessárias
RUN apt-get update && apt-get install -y \
    libgbm-dev \
    libwoff1 \
    libopus0 \
    libwebp-dev \
    libharfbuzz-dev \
    libgdk-pixbuf2.0-0 \
    libenchant-2-2 \
    libxss1 \
    libasound2 \
    libxtst6 \
    libegl1 \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Instala o pnpm
RUN curl -fsSL https://get.pnpm.io/install.sh | bash
ENV PATH="/root/.local/share/pnpm:${PATH}"

# Define o diretório de trabalho
WORKDIR /app

# Copia arquivos de dependências primeiro para otimizar cache
COPY package*.json ./
COPY pnpm-lock.yaml ./

# Instala dependências
RUN pnpm install

# Copia o código do projeto
COPY . .

# **Passo de Build (se estiver usando TypeScript)**
RUN pnpm build

# Expondo a porta (se necessário)
EXPOSE 3000

# Comando para rodar o app
CMD ["pnpm", "start"]
