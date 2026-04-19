import asyncio
from .socket.chat import ChatServer

async def main():
    server = ChatServer()
    try:
        await server.serve()
    finally:
        server.cleanup()

if __name__ == "__main__":
    asyncio.run(main())