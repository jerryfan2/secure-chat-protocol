import asyncio
import websockets
import sys
from models.models import MessageType, MessageData

class ChatClient:
    def __init__(self, user_id, domain="localhost", port=8765):
        self.user_id = user_id
        self.uri = f"ws://{domain}:{port}"
        self.websocket = None
    
    async def connect(self):
        try:
            async with websockets.connect(self.uri) as websocket:
                self.websocket = websocket
                await self.send_connection_message()
                print(f"Client {self.user_id} started! Connected to {self.uri}")
                await asyncio.gather(
                    self.receive_loop(),
                    self.send_loop(),
                    return_exceptions=True
                )
        except Exception as e:
            print(f"Connection error: {e}")
        finally:
            await websocket.close()

    async def send_connection_message(self):
        connection_message = MessageData(self.user_id, 0, MessageType.CONNECTION_SETUP, "")
        await self.websocket.send(connection_message.to_json())

    async def send_loop(self):
        loop = asyncio.get_running_loop()
        while True:
            user_input = await loop.run_in_executor(None, input)
            if not user_input:
                break
            split_index = user_input.index(" ")
            recipient_id = int(user_input[:split_index])
            message_content = user_input[split_index+1:]

            message = MessageData(self.user_id, recipient_id, MessageType.MESSAGE, message_content)
            await self.websocket.send(message.to_json())

    async def receive_loop(self):
        try:
            async for message in self.websocket:
                data = MessageData.from_json(message)
                match data.message_type:
                    case MessageType.MESSAGE:
                        displayed_message = f"{data.sent_time.strftime("%b %#d, %#I:%M %p")} User {data.recipient_id}: {data.content}"
                        print(displayed_message)

                    case _:
                        print(f"Client {self.user_id} received unknown message type")
        except websockets.ConnectionClosed:
            print("Connection closed by server.")


async def main(argv):
    if len(sys.argv) < 2:
        print("Usage: python client.py <user_id>")
        return

    client = ChatClient(user_id=int(sys.argv[1]))
    await client.connect()

if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:]))