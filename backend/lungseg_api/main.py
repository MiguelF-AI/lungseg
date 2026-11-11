from typing import List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from lungseg_api.catalog import get_study, list_studies
from lungseg_api.schemas import StudyDetail, StudySummary

app = FastAPI(title="LungSeg API")

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
    return list_studies()


@app.get("/api/studies/{study_id}", response_model=StudyDetail)
def study(study_id: str):
    try:
        return get_study(study_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
