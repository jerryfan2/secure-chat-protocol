import { useState, useRef, useEffect } from 'react'
import './App.css'
import { getPersistentKeyPair, deriveSharedSecret, exportPublicKey, encryptData, decryptData } from './utils/crypto';

interface ChatMessage {
  sender_id: number;
  recipient_id: number;
  message_type: string;
  content: string;
  sent_time: Date
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [chatStarted, setChatStarted] = useState<boolean>(false);
  const [userId, setUserId] = useState<string>('');
  const [recipientId, setRecipientId] = useState<string>('');

  const [myKeys, setMyKeys] = useState<CryptoKeyPair | null>(null);
  const myKeysRef = useRef<CryptoKeyPair | null>(null);

  const [secretRing, setSecretRing] = useState<Record<number, CryptoKey>>({})
  const secretRingRef = useRef<Record<number, CryptoKey>>({});

  const [pendingMessages, setPendingMessages] = useState<Record<number, ChatMessage[]>>({});
  const pendingMessagesRef = useRef<Record<number, ChatMessage[]>>({});

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState<string>('');

  const socket = useRef<WebSocket | null>(null);

  const processReceivedMsg = async (message: ChatMessage, secret: CryptoKey) => {
    const { ciphertext, iv } = JSON.parse(message.content);
    const decryptedText = await decryptData(ciphertext, iv, secret);
    const decryptedMsg = {...message, content: decryptedText};
    setMessages((prev) => [...prev, decryptedMsg]);
  }

  const processReceivedBatch = (waitingMessages: ChatMessage[], secret: CryptoKey) => {
    for (const msg of waitingMessages) {
      processReceivedMsg(msg, secret);
    }
  }

  useEffect(() => {
    myKeysRef.current = myKeys;
  }, [myKeys]);

  useEffect(() => {
    secretRingRef.current = secretRing;
  }, [secretRing]);

  useEffect(() => {
    pendingMessagesRef.current = pendingMessages
  }, [pendingMessages])

  useEffect(() => {
    if (!isLoggedIn) return;
    socket.current = new WebSocket('ws://localhost:8765');

    socket.current.onopen = async () => {
      console.log(`Connected as User ${userId}`);
      
      const keys = await getPersistentKeyPair();
      setMyKeys(keys);

      if (keys && keys.publicKey) {
        const publicKeyArray = await exportPublicKey(keys.publicKey);

        const setupMsg: ChatMessage = {
          sender_id: parseInt(userId),
          recipient_id: 0,
          message_type: "CONNECTION_SETUP",
          content: JSON.stringify(publicKeyArray),
          sent_time: new Date()
        };
        
        socket.current?.send(JSON.stringify(setupMsg));
      }
    };

    socket.current.onmessage = async (event: MessageEvent) => {
      const data = JSON.parse(event.data) as ChatMessage;
      if (data.message_type === "KEY_REQUEST") {
        const currentKeys = myKeysRef.current;

        if (currentKeys?.privateKey) {
          const theirId = data.sender_id;
          const theirPublicKeyRaw = JSON.parse(data.content)
          const bufferSource = new Uint8Array(theirPublicKeyRaw);
          const derivedSecret = await deriveSharedSecret(currentKeys.privateKey, bufferSource.buffer);
          console.log(`Setting shared key of user ${theirId} for user ${data.recipient_id}!`)
          
          secretRingRef.current[theirId] = derivedSecret;
          setSecretRing(prev => ({
            ...prev,
            [theirId]: derivedSecret
          }))

          const messagesToProcess = pendingMessagesRef.current[theirId] || []
          if (messagesToProcess.length > 0) {
            console.log(`Processing ${messagesToProcess.length} pending messages for ${theirId}`);
            processReceivedBatch(messagesToProcess, derivedSecret);
          }

          setPendingMessages(prevPending => {
            const nextPending = { ...prevPending };
            delete nextPending[theirId];
            return nextPending;
          })
        }
      } else if (data.message_type === "MESSAGE") {
        const senderId = data.sender_id;
        
        const sharedSecret = secretRingRef.current[senderId];
        if (!sharedSecret) {
          console.log(`No secret for user ${senderId}, requesting key...`);
          setPendingMessages(prev => ({
            ...prev,
            [senderId]: [...(prev[senderId] || []), data]
          }))
        }
        else {
          processReceivedMsg(data, sharedSecret);
        }
      } else if (data.message_type == "HISTORY_REQUEST") {
        const historyArray = JSON.parse(data.content) as ChatMessage[];
        const peerId = data.recipient_id
        const sharedSecret = secretRingRef.current[peerId]
        console.log(`User ${data.sender_id} received chat history with user ${peerId}`)
        if (!sharedSecret) {
          console.log("Shared secret not availble yet, putting into pending messages for now")
          setPendingMessages(prev => ({
            ...prev,
            [peerId]: [...historyArray, ...(prev[peerId] || [])]
          }))
        } else {
          console.log("Shared secret detected! Processing")
          processReceivedBatch(historyArray, sharedSecret);
        }
      }
    };

    socket.current.onclose = () => console.log("Socket closed");
    socket.current.onerror = (error) => console.error("WebSocket Error:", error);

    return () => {
      socket.current?.close();
    };
  }, [isLoggedIn]);

  useEffect(() => {
    if (socket.current?.readyState === WebSocket.OPEN && isLoggedIn && recipientId && myKeys) {
      console.log("Recipient number: ", recipientId)
      const uid = parseInt(userId);
      const targetId = parseInt(recipientId);
      const sharedSecret = secretRingRef.current[targetId];

      if (sharedSecret) {
        console.log(`Secret for ${targetId} already exists. Ready to chat.`);
      } else {
        console.log(`New recipient detected: ${targetId}. Requesting key...`);
        
        socket.current.send(JSON.stringify({
          message_type: "KEY_REQUEST",
          sender_id: uid,
          recipient_id: targetId,
          content: ""
        }));
      }

      socket.current.send(JSON.stringify({
        message_type: "HISTORY_REQUEST",
        sender_id: uid,
        recipient_id: targetId,
        content: ""
      }))
    }
  }, [chatStarted]);

  const sendMessage = async () => {
    const sharedSecret = secretRing[parseInt(recipientId)]
    if (!input || !socket.current || !sharedSecret) {
      alert("Encryption secret not established yet!");
      return;
    }
    const encryptedPackage = await encryptData(input, sharedSecret);

    const msg: ChatMessage = {
      sender_id: parseInt(userId),
      recipient_id: parseInt(recipientId),
      message_type: "MESSAGE",
      content: JSON.stringify(encryptedPackage),
      sent_time: new Date()
    };

    if (socket.current.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify(msg));
      
      const localDisplayMsg = { ...msg, content: input};
      setMessages((prev) => [...prev, localDisplayMsg]);
      setInput('');
    }
  };

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
          <button onClick={() => setIsLoggedIn(false)} style={styles.logoutBtn}>Change User</button>
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
            onClick={() => {
              setChatStarted(false);
              setMessages([]);
              setRecipientId('');
            }} 
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
                alignSelf: m.sender_id === parseInt(userId) ? 'flex-end' : 'flex-start',
                backgroundColor: m.sender_id === parseInt(userId) ? '#007bff' : '#e9e9eb',
                color: m.sender_id === parseInt(userId) ? 'white' : 'black',
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
        
        <button onClick={() => {
              setIsLoggedIn(false)
              setChatStarted(false);
              setMessages([]);
              setRecipientId('');
            }} style={styles.logoutBtn}>Logout</button>
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
