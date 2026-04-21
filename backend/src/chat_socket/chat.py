import websockets
from sqlalchemy.exc import IntegrityError
from dataclasses import asdict

from src.database.models import MessageType, WSMessage, KeyMismatchPayload
from src.database.database import SessionLocal
from src.database.crud import get_user_active_key, create_message_record

class ChatServer:
    def __init__(self, domain="localhost", port=8765):
        self.domain = domain
        self.port = port
        self.uri = f"ws://{domain}:{port}"
        
        self.user_to_websockets = {}
        self.websockets_to_user = {}

    async def serve(self):
        async with websockets.serve(self.receive_loop, self.domain, self.port) as server:
            print(f"Websockets server starting on {self.uri}")
            await server.serve_forever()

    async def receive_loop(self, websocket):
        try:
            async for message in websocket:
                data = WSMessage.from_json(message)
                match data.message_type:
                    case MessageType.CONNECTION_SETUP:
                        self.handle_connection_setup(websocket, data)

                    case MessageType.MESSAGE:
                        await self.handle_message(websocket, data)

                    case _:
                        print("Server: Unknown message type")

        except websockets.exceptions.ConnectionClosed:
            user_id = self.websockets_to_user.get(websocket, "Unknown")
            print(f"User {user_id} disconnected")

        finally:
            self.cleanup_connection(websocket)
    
    def handle_connection_setup(self, websocket, data):
        self.user_to_websockets[data.sender_id] = websocket
        self.websockets_to_user[websocket] = data.sender_id
        print(f"Registered sender {data.sender_id}")
    
    async def handle_message(self, websocket, data: WSMessage):
        print(f"Received: {data}")
        sender_id = data.sender_id
        recipient_id = data.recipient_id
        payload = data.payload
        sender_key_id = payload.sender_key_id
        recipient_key_id = payload.recipient_key_id
        with SessionLocal() as db:
            try:
                sender_active_key = get_user_active_key(db, sender_id)
                recipient_active_key = get_user_active_key(db, recipient_id)

                sender_key_mismatch = sender_key_id != sender_active_key.id
                recipient_key_mismatch = recipient_key_id != recipient_active_key.id
                if sender_key_mismatch or recipient_key_mismatch:
                    error_message = WSMessage(
                        message_type=MessageType.RECEIPT_ERROR,
                        client_msg_id=data.client_msg_id,
                        sender_id=sender_id,
                        recipient_id=recipient_id,
                        payload=KeyMismatchPayload(
                                sender_key_mismatch, 
                                recipient_key_mismatch
                            )
                    )
                    await websocket.send(error_message.to_json())
                else:
                    db_msg_record = create_message_record(db, data)
                    receipt_message = WSMessage(
                        message_type=MessageType.RECEIPT,
                        client_msg_id=data.client_msg_id,
                        sender_id=sender_id,
                        recipient_id=recipient_id,
                        payload=None
                    )
                    await websocket.send(receipt_message.to_json())
                    
                    if data.recipient_id in self.user_to_websockets:
                        data.payload.id = db_msg_record.id
                        data.payload.sent_at = db_msg_record.sent_at
                        await self.user_to_websockets[data.recipient_id].send(data.to_json())
            except IntegrityError:
                db.rollback()
                print("Duplicate message detected. Skipping")


    def cleanup_connection(self, websocket):
        user_id = self.websockets_to_user.get(websocket)
        
        if user_id is not None:
            self.user_to_websockets.pop(user_id, None)
            self.websockets_to_user.pop(websocket, None)
            print(f"User {user_id} disconnected and cleaned up.")
        else:
            print("A connection closed before registration.")
