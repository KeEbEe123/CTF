# Use Node.js LTS version
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Create database directory if it doesn't exist
RUN mkdir -p database

# Expose the port (Railway will use PORT env variable)
EXPOSE 3123

# Start the application
CMD ["npm", "start"]
