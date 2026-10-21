FROM node:20-alpine

WORKDIR /app

# Install production dependencies only
COPY web/package.json web/package-lock.json ./
RUN npm ci --omit=dev --omit=peer --omit=optional

# Copy the web app source
COPY web/ ./

EXPOSE 8080

# Bind to all interfaces so Docker can route to it
ENV HOST=0.0.0.0
ENV PORT=8080

CMD ["node", "server.js"]
