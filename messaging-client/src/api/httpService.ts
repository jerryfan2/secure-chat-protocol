import {
  type UserKeyServerResponse,
  type MessageRecordServerResponse
} from "../types/httpService.types";

const BASE_URL = 'http://127.0.0.1:8000';

async function handleResponse(response: Response) {
    if (!response.ok) {
      console.log(`Response was not ok: ${response.status}`);
      return null;
    }
    return response.json();
}

export const httpService = {
    fetchActivePublicKey: async (targetId: number): Promise<UserKeyServerResponse | null> => {
    const response = await fetch(`${BASE_URL}/key/${targetId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      }
    });
    return handleResponse(response);
  },
  fetchPublicKeyById: async (keyId: number): Promise<UserKeyServerResponse | null> => {
    const response = await fetch(`${BASE_URL}/keys/lookup/${keyId}`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
        }
    });
    return handleResponse(response);
  },
  fetchMessageHistory: async (userA: number, userB: number, limit: number = 50): Promise<MessageRecordServerResponse[]> => {
    const response = await fetch(`${BASE_URL}/messages/${userA}/${userB}?limit=${limit}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      }
    });
    return handleResponse(response);
  },
  uploadKey: async (userId: number, publicKey: number[]): Promise<UserKeyServerResponse> => {
    const response = await fetch(`${BASE_URL}/upload-key`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id: userId, public_key: JSON.stringify(publicKey) })
    });
    return handleResponse(response);
  }
}