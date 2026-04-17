import json
from datetime import datetime
from enum import Enum
from dataclasses import dataclass

class MessageType(str, Enum):
    CONNECTION_SETUP = 'CONNECTION_SETUP'
    MESSAGE = 'MESSAGE'
    KEY_REQUEST = 'KEY_REQUEST'
    HISTORY_REQUEST = 'HISTORY_REQUEST'

@dataclass
class MessageData:
    sender_id: int
    recipient_id: int
    message_type: MessageType
    content: str = ""
    sent_time: datetime = datetime.now()

    def to_json(self):
        return json.dumps({
        "sender_id": self.sender_id,
        "recipient_id": self.recipient_id,
        "message_type": self.message_type,
        "content": self.content,
        "sent_time": self.sent_time.isoformat()
        })
    
    @classmethod
    def from_json(cls, json_str):
        data = json.loads(json_str)
        if "sent_time" in data and isinstance(data["sent_time"], str):
            try:
                data["sent_time"] = datetime.fromisoformat(data["sent_time"])
            except ValueError:
                data["sent_time"] = datetime.now()
        return cls(**data)
