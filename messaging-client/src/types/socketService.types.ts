export type MessageType = 
  | "CONNECTION_SETUP" 
  | "MESSAGE" 
  | "RECEIPT"
  | "RECEIPT_ERROR"

export interface MessagePayload {
    id: number
    content: string
    sender_key_id: number
    recipient_key_id: number
    sent_at: Date
}

export interface KeyMismatchPayload {
    error_code: string
    sender_key_mismatch: boolean
    recipient_key_mismatch: boolean
}

export type WSMessage = 
    | {
        message_type: "MESSAGE";
        client_msg_id: string;
        sender_id: number;
        recipient_id: number;
        payload: MessagePayload;
    }
    | {
        message_type: "RECEIPT_ERROR";
        client_msg_id: string;
        sender_id: number;
        recipient_id: number;
        payload: KeyMismatchPayload;
    }
    | {
      message_type: "CONNECTION_SETUP" | "RECEIPT";
      client_msg_id: string;
      sender_id: number;
      recipient_id: number;
      payload: null;
    };