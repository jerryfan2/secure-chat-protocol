export interface MessageRecord {
  id: number,
  clientMsgId: string;
  senderId: number;
  recipientId: number;
  senderKeyId: number;
  recipientKeyId: number;
  content: string;
  sentAt: Date;
}

export interface UserKeyRecord {
    id: number;
    userId: number;
    keyPair: CryptoKeyPair;
    isActive: number; // 1 for true, 0 for false
    createdAt: Date;
}