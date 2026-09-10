FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3001
CMD ["npm", "start"]
