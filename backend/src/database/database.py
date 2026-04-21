from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from src.database.models import Base, MessageRecord, UserKey # to ensure all models are created

DB_NAME = 'messaging.db'
SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_NAME}"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(bind=engine)

def setup_database():
    Base.metadata.create_all(engine)