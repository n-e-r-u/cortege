FROM node:22-alpine
WORKDIR /app
COPY . .
RUN mkdir -p /data && chown node /data
ENV PORT=8080 TRUST_PROXY=1
EXPOSE 8080
USER node
CMD ["node", "server.js"]
