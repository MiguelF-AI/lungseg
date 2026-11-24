# Imagen del frontend LungSeg (React + Vite servido por nginx)
# Stage 1: compilación de la app
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: nginx sirve el dist y reenvía /api al backend
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

# nginx.conf: sirve el SPA y proxyea /api al contenedor del API
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
