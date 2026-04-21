export interface UserKeyServerResponse {
    id: number;
    user_id: number;
    public_key: string;
    creation_time: Date;
    is_active: boolean;
}

export interface MessageRecordServerResponse {
    id: number;
    client_msg_id: string;
    sender_id: number;
    recipient_id: number;
    sender_key_id: number;
    recipient_key_id: number;
    content: string;
    sent_at: Date;
}