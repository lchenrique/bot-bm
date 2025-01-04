FROM mcr.microsoft.com/playwright:v1.40.0-focal

WORKDIR /app

# Instalar dependências do sistema
RUN apt-get update && \
    apt-get install -y \
    libgbm-dev \
    libwoff1 \
    libopus0 \
    libwebp6 \
    libwebpdemux2 \
    libenchant1c2a \
    libgudev-1.0-0 \
    libsecret-1-0 \
    libhyphen0 \
    libgdk-pixbuf2.0-0 \
    libegl1 \
    libnotify4 \
    libxslt1.1 \
    libxcomposite1 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libepoxy0 \
    libgtk-3-0 \
    libgbm1 \
    libnss3 \
    libxss1 \
    libasound2

# Copiar arquivos do projeto
COPY package*.json ./
COPY . .

# Instalar dependências do Node.js
RUN npm install

# Instalar browsers do Playwright
RUN npx playwright install chromium

# Compilar TypeScript
RUN npm run build

# Expor porta
EXPOSE 8080

# Comando para iniciar
CMD ["npm", "start"] 