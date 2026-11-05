from celery import Celery
from .config import settings

app = Celery("interior", broker=settings.redis_url)
app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_soft_time_limit=270,
    task_time_limit=300,
)


@app.task(name="interior.process_job")
def run_job(jid):
    from .worker import process_job

    process_job(jid)
