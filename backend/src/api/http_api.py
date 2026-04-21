from fastapi import FastAPI, HTTPException, status, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.database.database import SessionLocal
from src.database.crud import get_user_active_key, get_key_by_id, rotate_user_key, get_message_history

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class KeyUpload(BaseModel):
    user_id: int
    public_key: str

def get_db():
    try:
        db = SessionLocal()
        yield db
    finally:
        db.close()

@app.get("/key/{user_id}")
async def get_active_key(user_id: int, db: Session = Depends(get_db)):
    key_record = get_user_active_key(db, user_id)

    if not key_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f'Active key for user {user_id} not found'
        )
    return key_record

@app.get("/keys/lookup/{key_id}")
async def get_specific_key(key_id: int, db: Session = Depends(get_db)):
    key_record = get_key_by_id(db, key_id)
    
    if not key_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f'Active key {key_id} not found'
        )
    return key_record

@app.post("/upload-key")
async def upload_key(data: KeyUpload, db: Session = Depends(get_db)):
    new_key = rotate_user_key(db, data.user_id, data.public_key)
    return new_key

@app.get("/messages/{user_a}/{user_b}")
async def get_history(user_a: int, user_b: int, limit: int = 50, db: Session = Depends(get_db)):
    return get_message_history(db, user_a, user_b, limit)