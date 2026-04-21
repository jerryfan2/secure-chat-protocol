import asyncio
import uvicorn

from src.chat_socket.chat import ChatServer
from src.database.database import setup_database
from src.api.http_api import app

async def run_http():
    host = '127.0.0.1'
    port = 8000
    config = uvicorn.Config(app, host=host, port=8000)
    server = uvicorn.Server(config)
    print(f"HTTP server starting on http://{host}:{port}")
    await server.serve()


async def main():
    setup_database()
    chat_server = ChatServer()
    await asyncio.gather(
        run_http(),
        chat_server.serve()
    )

if __name__ == "__main__":
    asyncio.run(main())