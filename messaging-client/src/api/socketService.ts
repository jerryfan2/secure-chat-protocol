import { type WSMessage } from "../types/socketService.types";

export type MessageHandler = (msg: WSMessage) => void;

let socket: WebSocket | null = null;

const ws_url = 'ws://localhost:8765';

export const socketService = {
    connect: (userId: number, onMessage: MessageHandler) => {
        if (socket) return;
        socket = new WebSocket(ws_url);

        socket.onmessage = (event: MessageEvent) => {
            const data = JSON.parse(event.data) as WSMessage;
            onMessage(data);
        }
        socket.onopen = () => {
            const setupMsg: WSMessage = {
                message_type: "CONNECTION_SETUP",
                client_msg_id: crypto.randomUUID(),
                sender_id: userId,
                recipient_id: 0,
                payload: null
            };
            socket!.send(JSON.stringify(setupMsg));
        }
        socket.onclose = () => console.log("Socket closed");
        socket.onerror = (error) => console.error("WebSocket Error:", error);
    },
    disconnect: () => {
        if (!socket) return;
        if (socket.readyState == WebSocket.OPEN)
            socket.close();
        socket = null;
    },
    sendMessage: (senderId: number, recipientId: number, 
        senderKeyId: number, recipientKeyId: number, 
        content: string): WSMessage | null => {
        if (!socket || socket.readyState != WebSocket.OPEN) return null;
        const msg: WSMessage = {
            message_type: "MESSAGE",
            client_msg_id: crypto.randomUUID(),
            sender_id: senderId,
            recipient_id: recipientId,
            payload: {
                id: 0,
                content: content,
                sender_key_id: senderKeyId,
                recipient_key_id: recipientKeyId,
                sent_at: new Date()
            }
        };
        socket.send(JSON.stringify(msg));
        return msg;
    }
}