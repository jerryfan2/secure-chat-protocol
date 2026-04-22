A real-time chat application built with React, WebSockets, and the Web Crypto API. This project implements a custom Diffie-Hellman key exchange (ECDH) to ensure zero-trust communication. 
Messages are encrypted end-to-end using AES-GCM, preventing any middleman, even the server, from reading messages. The FastAPI backend and React/TypeScript frontend handles complex cryptographic handshakes and message reconciliation,
and the Python-based asynchronous WebSocket server facilitates real-time message delivery and routing.
