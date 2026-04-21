from sqlalchemy.orm import Session
from sqlalchemy import select, update, and_, or_, desc, asc
from src.database.models import UserKey, MessageRecord, WSMessage

def get_user_active_key(db: Session, user_id: int):
    get_stmt = select(UserKey).where(UserKey.user_id == user_id, UserKey.is_active == True)
    result = db.execute(get_stmt)
    return result.scalar_one_or_none()

def get_key_by_id(db: Session, key_id: int):
    return db.get(UserKey, key_id)

def rotate_user_key(db: Session, user_id: int, public_key: str):
    deactivate_stmt = (
        update(UserKey)
        .where(UserKey.user_id == user_id, UserKey.is_active == True)
        .values(is_active=False)
    )
    db.execute(deactivate_stmt)
    
    new_key = UserKey(
        user_id=user_id,
        public_key=public_key,
        is_active=True
    )

    db.add(new_key)
    db.commit()
    db.refresh(new_key)
    return new_key

def get_message_history(db: Session, user_a: int, user_b: int, limit: int = 50):
    stmt = (select(MessageRecord)
        .where(
            or_(
                and_(MessageRecord.sender_id == user_a, MessageRecord.recipient_id == user_b),
                and_(MessageRecord.sender_id == user_b, MessageRecord.recipient_id == user_a)
            )
        ).order_by(desc(MessageRecord.sent_at)).limit(limit)
    )
    result = db.execute(stmt).scalars().all()
    return result[::-1]

def create_message_record(db: Session, msg_data: WSMessage):
    payload = msg_data.payload
    db_msg = MessageRecord(
        client_msg_id=msg_data.client_msg_id,
        sender_id=msg_data.sender_id,
        recipient_id=msg_data.recipient_id,

        sender_key_id = payload.sender_key_id,
        recipient_key_id = payload.recipient_key_id,
        content=payload.content,
    )
    db.add(db_msg)
    db.commit()
    db.refresh(db_msg)
    return db_msg