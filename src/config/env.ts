import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: process.env.PORT || 3000,
  innovatrics: {
    baseUrl: process.env.INNOVATRICS_BASE_URL || 'https://dot.innovatrics.com/identity',
    apiKey: process.env.INNOVATRICS_API_KEY || 'your_innovatrics_api_key',
    apiSecret: process.env.INNOVATRICS_API_SECRET || 'your_innovatrics_api_secret',
  },
};
