import asyncio
import websockets
import sqlite3
import json
from models.models import MessageType, MessageData

class ChatServer:
    def __init__(self, domain="localhost", port=8765):
        self.domain = domain
        self.port = port
        self.uri = f"ws://{domain}:{port}"
        self.user_to_websockets = {}
        self.websockets_to_user = {}

    def initialize_db(self):
        self.db_name = 'messaging.db'
        self.msg_table_name = "messages"
        self.keys_table_name = "keys"

        conn = sqlite3.connect(self.db_name)
        cursor = conn.cursor()
        self.db_conn = conn

        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS {self.msg_table_name} (
                id INTEGER PRIMARY KEY NOT NULL,
                sender_id INTEGER NOT NULL,
                recipient_id INTEGER NOT NULL,
                content TEXT NOT NULL,
                sent_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
            );
            '''
        )
        
        cursor.execute(f'''
            CREATE INDEX IF NOT EXISTS idx_conversation
                ON {self.msg_table_name} (sender_id, recipient_id, sent_time);
            '''
        )

        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS {self.keys_table_name} (
                user_id INTEGER PRIMARY KEY NOT NULL,
                key_str TEXT NOT NULL,
                creation_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
            );
            '''
        )

        conn.commit()

    async def serve(self):
        async with websockets.serve(self.receive_loop, self.domain, self.port) as server:
            print(f"Server starting on {self.uri}")
            await server.serve_forever()

    async def receive_loop(self, websocket):
        try:
            async for message in websocket:
                data = MessageData.from_json(message)
                match data.message_type:
                    case MessageType.CONNECTION_SETUP:
                        self.user_to_websockets[data.sender_id] = websocket
                        self.websockets_to_user[websocket] = data.sender_id

                        self.db_conn.cursor().execute(f'''
                                INSERT INTO {self.keys_table_name}
                                VALUES (?, ?, ?)
                                ON CONFLICT(user_id) DO UPDATE SET
                                    key_str = EXCLUDED.key_str,
                                    creation_time = EXCLUDED.creation_time
                            ''', (data.sender_id, data.content, data.sent_time.isoformat())
                        )
                        self.db_conn.commit()
                        print(f"Registered sender {data.sender_id}")

                    case MessageType.MESSAGE:
                        print(f"Received: {data}")
                        time_str = data.sent_time.isoformat()
                        self.db_conn.cursor().execute(f"""
                                INSERT INTO {self.msg_table_name}
                                VALUES (NULL, ?, ?, ?, ?)
                            """, (data.sender_id, data.recipient_id, data.content, time_str)
                        )
                        self.db_conn.commit()
                        if data.recipient_id in self.user_to_websockets:
                            await self.user_to_websockets[data.recipient_id].send(data.to_json())

                    case MessageType.KEY_REQUEST:
                        uid = data.sender_id
                        peer_id = data.recipient_id
                        print(f"User {uid} requesting key for user {peer_id}")

                        cursor = self.db_conn.cursor()
                        cursor.execute(f"""
                            SELECT user_id, key_str
                            FROM {self.keys_table_name}
                            WHERE user_id = ? OR user_id = ? 
                        """, (uid, peer_id)
                        )
                        results = cursor.fetchall()
                        key_map = {row[0]: row[1] for row in results}

                        if peer_id in key_map:
                            response = MessageData(
                                peer_id,
                                uid,
                                MessageType.KEY_REQUEST,
                                key_map[peer_id]
                            )
                            await self.user_to_websockets[uid].send(response.to_json())
                            print(f"User {peer_id} sent public key to user {uid}")
                        
                        if uid in key_map and peer_id in self.user_to_websockets:
                            forward_msg = MessageData(
                                uid,
                                peer_id,
                                MessageType.KEY_REQUEST,
                                key_map[uid]
                            )
                            await self.user_to_websockets[peer_id].send(forward_msg.to_json())
                            print(f"User {uid} sent public key to user {peer_id}")

                    case MessageType.HISTORY_REQUEST:
                        uid = data.sender_id
                        peer_id = data.recipient_id

                        cursor = self.db_conn.cursor()

                        cursor.execute('''
                                SELECT * FROM (
                                    SELECT sender_id, recipient_id, content, sent_time
                                    FROM messages
                                    WHERE (sender_id = ? AND recipient_id = ?)
                                        OR (sender_id =? AND recipient_id = ?)
                                    ORDER by sent_time DESC
                                    LIMIT 50  
                                )
                                ORDER BY sent_time asc           
                            ''', (uid, peer_id, peer_id, uid)
                        )

                        rows = cursor.fetchall()
                        messages = [{
                            "sender_id": row[0],
                            "recipient_id": row[1],
                            "message_type": MessageType.MESSAGE,
                            "content": row[2],
                            "sent_time": row[3]
                        } for row in rows]

                        msg = MessageData(uid, peer_id, MessageType.HISTORY_REQUEST, json.dumps(messages))
                        await self.user_to_websockets[uid].send(msg.to_json())
                        print(f"History of user {uid}, {peer_id} sent to user {uid}")


                    case _:
                        print("Server: Unknown message type")

        except websockets.exceptions.ConnectionClosed:
            user_id = self.websockets_to_user.get(websocket, "Unknown")
            print(f"User {user_id} disconnected")

        finally:
            self.cleanup_connection(websocket)
    

    def cleanup_connection(self, websocket):
        user_id = self.websockets_to_user.get(websocket)
        
        if user_id is not None:
            self.user_to_websockets.pop(user_id, None)
            self.websockets_to_user.pop(websocket, None)
            print(f"User {user_id} disconnected and cleaned up.")
        else:
            print("A connection closed before registration.")


async def main():
    server = ChatServer()
    server.initialize_db()
    await server.serve()
    server.db_conn.close()

if __name__ == "__main__":
    asyncio.run(main())