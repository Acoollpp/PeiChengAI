# Stage 0, "build-stage", based on Node.js, to build and compile the frontend
FROM mirror.gcr.io/library/node:22-alpine AS build-stage

WORKDIR /app

COPY package.json /app/

COPY frontend/package.json /app/frontend/

RUN npm install --workspace frontend

COPY ./frontend /app/frontend
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build --workspace frontend


# Stage 1, based on Nginx, to have only the compiled app, ready for production with Nginx
FROM nginx:1

COPY --from=build-stage /app/frontend/dist/ /usr/share/nginx/html
RUN find /usr/share/nginx/html -type d -exec chmod 755 {} \; \
    && find /usr/share/nginx/html -type f -exec chmod 644 {} \;

COPY ./frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY ./frontend/nginx-backend-not-found.conf /etc/nginx/extra-conf.d/backend-not-found.conf
