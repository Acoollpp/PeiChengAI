from app.events import InMemoryEventBus
from app.main import create_app
from app.scheduler import InMemoryScheduler
from app.testing import InMemoryTaskRepository


app = create_app(
    repo=InMemoryTaskRepository(),
    scheduler=InMemoryScheduler(),
    event_bus=InMemoryEventBus(),
)
