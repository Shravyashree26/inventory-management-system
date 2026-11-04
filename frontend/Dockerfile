# Build stage
FROM node:18 AS build

WORKDIR /app

# Copy package.json and package-lock.json to the container
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the React app
RUN npm run build

# Serve stage
FROM nginx:1.28-alpine
RUN apk upgrade --no-cache

# Copy the custom nginx.conf file to the container
COPY .docker/default.conf.template /etc/nginx/templates/default.conf.template
ENV BACKEND_HOST=spring-boot-app NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1

# Copy the built React app from the build stage to the nginx container
COPY --from=build /app/build /usr/share/nginx/html

# Expose port 80
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
