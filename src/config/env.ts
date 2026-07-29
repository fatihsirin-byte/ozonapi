import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  ozonClientId: required("OZON_CLIENT_ID"),
  ozonApiKey: required("OZON_API_KEY"),
  ozonBaseUrl: process.env.OZON_BASE_URL ?? "https://api-seller.ozon.ru",
};
