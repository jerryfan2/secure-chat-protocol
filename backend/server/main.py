import asyncio
import websockets
import json
from models.models import MessageType, MessageData, Base, MessageRecord, UserKey
from sqlalchemy import create_engine, select, and_, or_, desc, asc
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from sqlalchemy.dialects.sqlite import insert

class ChatServer:
    def __init__(self, domain="localhost", port=8765):
        self.domain = domain
        self.port = port
        self.uri = f"ws://{domain}:{port}"
        self.user_to_websockets = {}
        self.websockets_to_user = {}

    def initialize_db(self):
        self.db_name = 'messaging.db'
        engine = create_engine(f"sqlite:///{self.db_name}")

        Base.metadata.create_all(engine)
        self.session = Session(engine)
        

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
                        self.handle_connection_setup(websocket, data)

                    case MessageType.MESSAGE:
                        await self.handle_message(websocket, data)

                    case MessageType.KEY_REQUEST:
                        await self.handle_key_request(websocket, data)

                    case MessageType.HISTORY_REQUEST:
                        await self.handle_history_request(websocket, data)

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

        stmt = insert(UserKey).values(
            user_id=data.sender_id,
            public_key=data.content
        )
        upsert_stmt = stmt.on_conflict_do_update(
            index_elements=['user_id'],
            set_=dict(public_key = data.content)
        )
        self.session.execute(upsert_stmt)
        self.session.commit()
        print(f"Registered sender {data.sender_id}")
    
    async def handle_message(self, websocket, data):
        print(f"Received: {data}")
        try:
            message_record = MessageRecord(
                sender_id=data.sender_id,
                recipient_id=data.recipient_id,
                content=data.content
            )
            self.session.add(message_record)
            self.session.commit()
        except IntegrityError:
            self.session.rollback()
            print("Duplicate message detected. Skipping")
        if data.recipient_id in self.user_to_websockets:
            await self.user_to_websockets[data.recipient_id].send(data.to_json())

    async def handle_key_request(self, websocket, data):
        uid = data.sender_id
        peer_id = data.recipient_id
        print(f"User {uid} requesting key for user {peer_id}")

        stmt = select(UserKey).where(
            or_(UserKey.user_id == uid, UserKey.user_id == peer_id)
        )

        results = self.session.execute(stmt).scalars().all()
        key_map = {row.user_id: row.public_key for row in results}

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

    async def handle_history_request(self, websocket, data):
        uid = data.sender_id
        peer_id = data.recipient_id

        inner_stmt = select(MessageRecord).where(
            or_(
                and_(MessageRecord.sender_id == uid, MessageRecord.recipient_id == peer_id),
                and_(MessageRecord.sender_id == peer_id, MessageRecord.recipient_id == uid)
            )
        ).order_by(desc(MessageRecord.sent_at)).limit(50)
        subq = inner_stmt.subquery()
        outer_stmt = (
            select(subq)
            .order_by(asc(subq.c.sent_at))
        )
        rows = self.session.execute(outer_stmt).all()

        messages = [{
            "sender_id": row.sender_id,
            "recipient_id": row.recipient_id,
            "message_type": MessageType.MESSAGE,
            "content": row.content,
        } for row in rows]

        msg = MessageData(uid, peer_id, MessageType.HISTORY_REQUEST, json.dumps(messages))
        await self.user_to_websockets[uid].send(msg.to_json())
        print(f"History of user {uid}, {peer_id} sent to user {uid}")


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
    server.session.close()

if __name__ == "__main__":
    asyncio.run(main())