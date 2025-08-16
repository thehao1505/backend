# --- Base (định nghĩa biến dùng lại)
FROM  node:22-alpine AS base
WORKDIR /app

# --- Cài deps (bao gồm dev deps để build)
FROM base AS deps
COPY package*.json ./
RUN npm ci

# --- Build NestJS (transpile TS -> dist)
FROM deps AS build
COPY . .
RUN npm run build

# --- Runtime (chỉ prod deps + dist)
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
