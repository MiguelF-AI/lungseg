from typing import List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from lungseg_api.catalog import get_study, list_studies
from lungseg_api.metrics import read_cached_metrics
from lungseg_api.routers.files import router as files_router
from lungseg_api.routers.metrics import router as metrics_router
from lungseg_api.schemas import StudyDetail, StudySummary

app = FastAPI(title="LungSeg API")
app.include_router(files_router)
app.include_router(metrics_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/studies", response_model=List[StudySummary])
def studies():
    # lesion_pct/lesion_l salen SOLO de métricas ya cacheadas: la lista no
    # calcula nada (con muchos estudios sería lento). Sin caché → null.
    summaries = list_studies()
    for summary in summaries:
        cached = read_cached_metrics(summary.id)
        if cached is not None:
            summary.lesion_pct = cached.lesion_pct_of_lung
            summary.lesion_l = cached.lesion_l
    return summaries


@app.get("/api/studies/{study_id}", response_model=StudyDetail)
def study(study_id: str):
    try:
        detail = get_study(study_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    cached = read_cached_metrics(study_id)
    if cached is not None:
        detail.lesion_pct = cached.lesion_pct_of_lung
        detail.lesion_l = cached.lesion_l
    return detail
