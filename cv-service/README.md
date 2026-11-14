# BUKC Equipment Health Check — CV service

FastAPI microservice: photo(s) of a Basketball / Football / Volleyball → health score 0–100,
Good/Fair/Poor/Replace label, anomaly % and a damage heatmap.
Frozen DINOv2 ViT-S/14 + rembg (ISNet) background replacement + patch-level "memory of normal".

Full explanation, dataset plan and formulas: `../docs/EQUIPMENT_HEALTH_CHECK_GUIDE.md`.

```powershell
# one-time (Python 3.11)
py -3.11 -m venv .venv ; .venv\Scripts\activate        # macOS/Linux: python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt                        # Linux: install CPU torch first (see requirements.txt)
python -m scripts.download_models
copy .env.example .env
python -m scripts.check_dataset --create               # then add photos to dataset/

# after the photo session
python -m scripts.check_dataset
python -m scripts.build_bank
python -m scripts.calibrate

# run
uvicorn app.main:app --host 127.0.0.1 --port 8001 --env-file .env
```

Test: `curl -X POST http://127.0.0.1:8001/v1/health-check -F equipment_type=basketball -F images=@photo.jpg`
