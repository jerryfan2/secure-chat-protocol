import { useState, useRef, useEffect } from 'react'
import './App.css'
import { getPersistentKeyPair, deriveSharedSecret, encryptData, decryptData } from './utils/crypto';
import { type MessageRecord, type UserKeyRecord } from './models/models';
import { httpService} from './api/httpService';
import { socketService } from './api/socketService';
import { type WSMessage } from './types/socketService.types';
import { mapHttpMessageResponse, mapWSMessageResponse } from './api/mappers';

function App() {

  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [chatStarted, setChatStarted] = useState<boolean>(false);

  const [userId, setUserId] = useState<string>('');
  const userIdRef = useRef<string>('');

  const [recipientId, setRecipientId] = useState<string>('');
  const recipientIdRef = useRef<string>('');

  const activeKeyIdRef = useRef<number | null>(null);
  const myKeysRef = useRef<Map<number, CryptoKeyPair>>(new Map());
  const peerPublicKeyIdsRef = useRef<Map<number, number>>(new Map());
  // shared keys used combined, sorted keys
  const sharedKeysSecretRingRef = useRef<Map<string, CryptoKey>>(new Map());

  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [input, setInput] = useState<string>('');
  
  function getSharedCacheKey(idA: number, idB: number): string {
    const [first, second] = [idA, idB].sort((a, b) => a - b);
    return `${first}:${second}`;
  }

  const processReceivedMsg = async (message: MessageRecord) => {
    const senderId = message.senderId;
    const recipientId = message.recipientId;
    if (!((message.senderId === senderId && message.recipientId === recipientId) ||
        (message.recipientId === recipientId && message.senderId === senderId)))
      return;

    const senderKeyId = message.senderKeyId
    const recipientKeyId = message.recipientKeyId;
    const sharedCacheKey = getSharedCacheKey(senderKeyId, recipientKeyId);

    let sharedSecret = sharedKeysSecretRingRef.current.get(sharedCacheKey);
    if (!sharedSecret) {
      if (senderKeyId != activeKeyIdRef.current || 
        recipientKeyId != activeKeyIdRef.current) return;

      const fetchedKey = senderKeyId == activeKeyIdRef.current ? 
        await fetchPublicKeyById(recipientKeyId) :
        await fetchPublicKeyById(senderKeyId);
      const sharedKey = await calculateSharedFromRawPublicKey(fetchedKey);
      if (sharedKey) {
        sharedSecret = sharedKey;
        sharedKeysSecretRingRef.current.set(sharedCacheKey, sharedKey);
      }
    }
    if (!sharedSecret) return;
    const { ciphertext, iv } = JSON.parse(message.content);
    const decryptedText = await decryptData(ciphertext, iv, sharedSecret);
    
    const msgRecord: MessageRecord = {
      ...message,
      content: decryptedText
    }
    setMessages((prev) => [...prev, msgRecord]);
  };

  const processReceivedBatch = async (waitingMessages: MessageRecord[]) => {
    for (const msg of waitingMessages) {
      await processReceivedMsg(msg);
    }
  };

  useEffect(() => {
    recipientIdRef.current = recipientId;
  }, [recipientId]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    if (!isLoggedIn) return;
    console.log(`Log-in detected. Origin: ${window.location.origin}, User: ${userId}`);

    const initializeSecurity = async () => {
      const keys: UserKeyRecord = await getPersistentKeyPair(parseInt(userIdRef.current));
      activeKeyIdRef.current = keys.id;
      myKeysRef.current.set(keys.id, keys.keyPair);
      console.log(`User ${userId} set active key: ${keys.id}`);
    }
    initializeSecurity();
    socketService.connect(parseInt(userIdRef.current), async (msg: WSMessage ) => {
      switch (msg.message_type) {
        case "MESSAGE":
          await handleReceiveMessage(msg);
          break;
        case "RECEIPT":
          break
        case "RECEIPT_ERROR":
          await handleReceiveReceiptError(msg);
          break;
        default:
          console.warn("Unknown message type received:", msg.message_type);
      }
    });
    console.log(`Connected as User ${userId}`);

    return () => {
      socketService.disconnect();
    };
  }, [isLoggedIn]);

  useEffect(() => {
    if (!chatStarted) return;
    if (!(isLoggedIn && recipientId && activeKeyIdRef.current)) return;
    console.log("Recipient number:", recipientId)
    const uid = parseInt(userId);
    const targetId = parseInt(recipientId);

    (async () => {
      const receivedPeerKey = await fetchAndSetPeerKeys(targetId);
      if (!receivedPeerKey) {
        setChatStarted(false);
        return;
      }
      await fetchAndSetMessageHistory(uid, targetId);
    })();
  }, [chatStarted]);

  async function fetchAndSetMessageHistory(userA: number, userB: number) {
    const msgHistoryResponse = await httpService.fetchMessageHistory(userA, userB);
    const msgHistory = msgHistoryResponse.map((msg) => mapHttpMessageResponse(msg)).filter(msg => msg != null);
    processReceivedBatch(msgHistory);
    console.log(`User ${userA} received conversation with user ${userB}`);
  }

  async function fetchAndSetPeerKeys(peerId: number): Promise<boolean> {
    const activeKeyId = activeKeyIdRef.current;
    if (!activeKeyId) return false;

    const targetPublicKeyResponse = await httpService.fetchActivePublicKey(peerId);
    if (targetPublicKeyResponse) {
      const targetKeyId = targetPublicKeyResponse.id;
      const secretRingCacheKey = getSharedCacheKey(activeKeyId, targetKeyId);

      peerPublicKeyIdsRef.current.set(peerId, targetKeyId);
      const targetPublicKeyRaw: number[] = JSON.parse(targetPublicKeyResponse.public_key);
      const sharedKey = await calculateSharedFromRawPublicKey(targetPublicKeyRaw);
      if (sharedKey) {
        console.log(`Setting shared key of user ${peerId} for user ${userId}!`)
        sharedKeysSecretRingRef.current.set(secretRingCacheKey, sharedKey);
        return true;
      }
    }
    return false;
  }

  async function fetchPublicKeyById(keyId: number) {
    const response = await httpService.fetchPublicKeyById(keyId);
    if (!response) return null;
    return JSON.parse(response.public_key);
  }

  async function calculateSharedFromRawPublicKey(publicKeyRaw: number[]) {
    const bufferSource = new Uint8Array(publicKeyRaw);
    if (!activeKeyIdRef.current) return null;
    const activeKey = myKeysRef.current.get(activeKeyIdRef.current);
    if (!activeKey) return null;
    return await deriveSharedSecret(activeKey.privateKey, bufferSource.buffer);
  }

  async function handleReceiveReceiptError(data: WSMessage) {
    if (data.message_type != "RECEIPT_ERROR") return;
    const msgId = data.client_msg_id;
    if (data.payload.sender_key_mismatch) {
      console.log(`Message ${msgId} sent with expired private key`);
      // Log out user, possibly try to get new key
    } else if (data.payload.recipient_key_mismatch) {
      fetchAndSetPeerKeys(data.recipient_id);
      const plainMsg = messages.find(m => m.clientMsgId == data.client_msg_id);
      if (plainMsg) {
        encryptSendMessage(data.recipient_id, plainMsg.content);
      }
    }
  }

  async function handleReceiveMessage(data: WSMessage) {
    console.log(`User ${userId} received message from ${data.sender_id}`)
    if (data.message_type != "MESSAGE") return;
    const messageRecord = mapWSMessageResponse(data)
    if (!messageRecord) return;
    await processReceivedMsg(messageRecord);
  }

  async function encryptSendMessage(recipientId: number, text: string) {
    if (!text) return;
    const userActiveKeyId = activeKeyIdRef.current;
    if (!userActiveKeyId) return;
    const uid = parseInt(userId);
    const peerKeyId = peerPublicKeyIdsRef.current.get(recipientId);
    if (!peerKeyId) return;
    const sharedCacheKey = getSharedCacheKey(userActiveKeyId, peerKeyId);

    const sharedSecret = sharedKeysSecretRingRef.current.get(sharedCacheKey);

    if (!sharedSecret) {
      alert("Encryption secret not established yet!");
      return;
    }
    const encryptedPackage = await encryptData(text, sharedSecret);

    return socketService.sendMessage(uid, recipientId, userActiveKeyId, peerKeyId,
      JSON.stringify(encryptedPackage));
  }

  const sendMessage = async () => {
    const peerId = parseInt(recipientId);
    const msg = await encryptSendMessage(peerId, input);
    if (!msg) return;
    const msgRecord = mapWSMessageResponse(msg);
    if (!msgRecord) return;
    const msgPlainRecord: MessageRecord = {
      ...msgRecord,
      content: input
    }
      
    setMessages((prev) => [...prev, msgPlainRecord]);
    setInput('');
  };

  
  function logout() {
    setIsLoggedIn(false);
    setChatStarted(false);
    setUserId('');
    setRecipientId('');
    setMessages([]);
    setInput('');
  }

  function leaveChat() {
    setChatStarted(false);
    setRecipientId('');
    setMessages([]);
    setInput('');
  }

  if (!isLoggedIn) {
    return (
      <div style={styles.centered}>
        <form onSubmit={(e) => { e.preventDefault(); setIsLoggedIn(true); }} style={styles.card}>
          <h3>Identify Yourself</h3>
          <input 
            type="number" 
            placeholder="Your ID" 
            value={userId} 
            onChange={(e) => setUserId(e.target.value)} 
            style={styles.input} 
          />
          <button type="submit" style={styles.button}>Login</button>
        </form>
      </div>
    );
  }

  if (isLoggedIn && !chatStarted) {
    return (
      <div style={styles.centered}>
        <div style={styles.card}>
          <h3>Welcome, User {userId}</h3>
          <p>Who would you like to secure chat with?</p>
          <input 
            type="number" 
            placeholder="Enter Recipient ID" 
            value={recipientId} 
            onChange={(e) => setRecipientId(e.target.value)} 
            style={styles.input} 
          />
          <button 
            onClick={() => setChatStarted(true)} 
            style={styles.button}
          >
            Start Secure Chat
          </button>
          <button onClick={() => logout()} style={styles.logoutBtn}>Change User</button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.centered}>
      <div style={styles.card}>
        <div style={styles.headerRow}>
          <h4>Talking to: {recipientId}</h4>
          <button 
            onClick={() => leaveChat()} 
            style={styles.backBtn}
          >
            Back
          </button>
        </div>
        
        <div style={styles.chatWindow}>
          {messages.map((m, i) => (
            <div 
              key={i} 
              style={{
                ...styles.msgBase,
                alignSelf: m.senderId === parseInt(userId) ? 'flex-end' : 'flex-start',
                backgroundColor: m.senderId === parseInt(userId) ? '#007bff' : '#e9e9eb',
                color: m.senderId === parseInt(userId) ? 'white' : 'black',
              }}
            >
              {m.content}
            </div>
          ))}
        </div>

        <div style={styles.inputRow}>
          <input 
            value={input} 
            onChange={(e) => setInput(e.target.value)} 
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            style={styles.flexInput}
          />
          <button onClick={sendMessage} style={styles.sendBtn}>Send</button>
        </div>
        
        <button onClick={() => logout()} style={styles.logoutBtn}>Logout</button>
      </div>
    </div>
  );
};

// --- Styles ---
const styles: { [key: string]: React.CSSProperties } = {
  centered: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#f0f2f5' },
  card: { background: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)', width: '350px', display: 'flex', flexDirection: 'column' },
  input: { padding: '10px', marginBottom: '10px', borderRadius: '4px', border: '1px solid #ddd' },
  button: { padding: '10px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' },
  chatWindow: { height: '300px', border: '1px solid #eee', overflowY: 'auto', marginBottom: '10px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' },
  msgBase: { padding: '8px 12px', borderRadius: '15px', maxWidth: '80%', fontSize: '14px' },
  inputRow: { display: 'flex', gap: '5px' },
  flexInput: { flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #ddd' },
  sendBtn: { padding: '8px 15px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px' },
  logoutBtn: { marginTop: '15px', border: 'none', background: 'none', color: '#888', cursor: 'pointer', fontSize: '12px' }
};

export default App
