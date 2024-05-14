# Use the official Node.js runtime as the base image
FROM node:14-alpine3.17

# Set the working directory in the container to /app
WORKDIR /app

# Copy the package.json and package-lock.json files into the container
COPY package*.json ./

# Install the application's dependencies inside the container
RUN npm install

# Copy the rest of the application's source code into the container
COPY . .

# Inform Docker that the container listens on port 8080
EXPOSE 8080

# Define the command that should be executed when the container starts
CMD [ "node", "app.js" ]