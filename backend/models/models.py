import json
from datetime import datetime
from enum import Enum
from dataclasses import dataclass

from sqlalchemy import String, Integer, func, Index
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

class MessageType(str, Enum):
    CONNECTION_SETUP = 'CONNECTION_SETUP'
    MESSAGE = 'MESSAGE'
    KEY_REQUEST = 'KEY_REQUEST'
    HISTORY_REQUEST = 'HISTORY_REQUEST'

@dataclass
class MessageData:
    client_msg_id: str
    sender_id: int
    recipient_id: int
    message_type: MessageType
    content: str = ""

    def to_json(self):
        return json.dumps({
        "client_msg_id": self.client_msg_id,
        "sender_id": self.sender_id,
        "recipient_id": self.recipient_id,
        "message_type": self.message_type,
        "content": self.content,
        })
    
    @classmethod
    def from_json(cls, json_str):
        data = json.loads(json_str)
        return cls(**data)

class Base(DeclarativeBase):
    pass

class MessageRecord(Base):
    __tablename__ = 'messages'

    id: Mapped[str] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_msg_id: Mapped[str] = mapped_column(String, unique=True, nullable=False)

    sender_id: Mapped[int] = mapped_column(Integer, nullable=False)
    recipient_id: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(String, nullable=False)
    sent_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_conversation", "sender_id", "recipient_id", "sent_at"),
    )

class UserKey(Base):
    __tablename__ = 'keys'

    # id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(primary_key=True)
    public_key: Mapped[str] = mapped_column(String)
    creation_time: Mapped[datetime] = mapped_column(server_default=func.now())