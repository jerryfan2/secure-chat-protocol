# Secret Ring Encrypted Messenger

A real-time chat application built with React, WebSockets, and the Web Crypto API. This project implements a custom Diffie-Hellman key exchange (ECDH) to ensure zero-trust communication. 
Messages are encrypted end-to-end using AES-GCM, preventing any middleman, even the server, from reading messages. The FastAPI backend and React/TypeScript frontend handles complex cryptographic handshakes and message reconciliation,
and the Python-based asynchronous WebSocket server facilitates real-time message delivery and routing.

## How It's Made:
**Tech Used:** React/TypeScript, Python, FastAPI/Uvicorn, SQLAlchemy, SQLite, Websockets
React/TypeScript frontend used for the user-facing client, initializing key encryption, storing private keys to local IndexedDB, and setting up Websockets connection.
Python Uvicorn is used to run two servers. The HTTP server built on FastAPI is used to provision and fetch encryption key records, obtain message histories, and initialize new users.
The Websockets server runs on a separate endpoint to handle real-time messages from a user and routing to a recipient. SQLAlchemy is used for interactions with a local SQLite database that stores encrypted messages, key records, and relevant user information.
