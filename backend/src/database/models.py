import json
from datetime import datetime
from enum import Enum
from dataclasses import dataclass, asdict
from typing import Union

from sqlalchemy import String, Integer, func, Index, ForeignKey
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

class MessageType(str, Enum):
    CONNECTION_SETUP = 'CONNECTION_SETUP'
    MESSAGE = 'MESSAGE'
    RECEIPT = "RECEIPT"
    RECEIPT_ERROR = "RECEIPT_ERROR"

@dataclass
class MessagePayload:
    id: int
    content: str
    sender_key_id: int
    recipient_key_id: int
    sent_at: datetime

@dataclass
class KeyMismatchPayload:
    error_code: str = "KEY_MISMATCH"
    sender_key_mismatch: bool = False
    recipient_key_mismatch: bool = False

@dataclass
class WSMessage:
    message_type: MessageType
    client_msg_id: str
    sender_id: int
    recipient_id: int
    payload: Union[MessagePayload, KeyMismatchPayload, None]

    def to_json(self):
        def custom_serializer(obj):
            if isinstance(obj, datetime):
                return obj.isoformat()
            if isinstance(obj, MessageType):
                return obj.value
            raise TypeError(f"Type {type(obj)} not serializable")

        return json.dumps(asdict(self), default=custom_serializer)
    
    @classmethod
    def from_json(cls, json_str):
        data = json.loads(json_str)
        payload_dict = data.get('payload')
        msg_type = data.get('message_type')

        if payload_dict:
            if msg_type == MessageType.MESSAGE:
                data['payload'] = MessagePayload(**payload_dict)
            elif msg_type == MessageType.RECEIPT_ERROR:
                data['payload'] = KeyMismatchPayload(**payload_dict)
        return cls(**data)

class Base(DeclarativeBase):
    pass

class MessageRecord(Base):
    __tablename__ = 'messages'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_msg_id: Mapped[str] = mapped_column(String, unique=True, nullable=False)

    sender_id: Mapped[int] = mapped_column(Integer, nullable=False)
    recipient_id: Mapped[int] = mapped_column(Integer, nullable=False)
    
    sender_key_id: Mapped[int] = mapped_column(Integer, nullable=False)
    recipient_key_id: Mapped[int] = mapped_column(Integer, nullable=False)

    content: Mapped[str] = mapped_column(String, nullable=False)
    sent_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_conversation", "sender_id", "recipient_id", "sent_at"),
    )

class UserKey(Base):
    __tablename__ = 'keys'

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey(f'{MessageRecord.__tablename__}.{MessageRecord.id.name}'), nullable=False)
    public_key: Mapped[str] = mapped_column(String, nullable=False)
    creation_time: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    is_active: Mapped[bool] = mapped_column(default=False, nullable=False)

    __table_args__ = (
        Index(
            'unique_active_key_per_user',
            user_id,
            unique=True,
            sqlite_where=(is_active == True)
        ),
    )