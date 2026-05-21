FROM node:20-alpine

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY backend ./backend
COPY assets ./assets
COPY dashboard.html admin.html login.html register.html ./

WORKDIR /app/backend

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
