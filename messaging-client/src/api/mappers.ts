import { type MessageRecordServerResponse } from "../types/httpService.types";
import { type MessageRecord } from "../models/models";
import type { WSMessage } from "../types/socketService.types";

export const mapHttpMessageResponse = (raw: MessageRecordServerResponse): MessageRecord => {
    return {
        id: raw.id,
        clientMsgId: raw.client_msg_id,
        senderId: raw.sender_id,
        recipientId: raw.recipient_id,
        senderKeyId: raw.sender_key_id,
        recipientKeyId: raw.recipient_key_id,
        content: raw.content,
        sentAt: raw.sent_at,
    };
}

export const mapWSMessageResponse = (raw: WSMessage): MessageRecord | null => {
    if (raw.message_type != "MESSAGE") return null;
    return {
        id: raw.payload.id,
        clientMsgId: raw.client_msg_id,
        senderId: raw.sender_id,
        recipientId: raw.recipient_id,
        senderKeyId: raw.payload.sender_key_id,
        recipientKeyId: raw.payload.recipient_key_id,
        content: raw.payload.content,
        sentAt: raw.payload.sent_at,
    }
}