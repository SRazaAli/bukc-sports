# Calibration report - Basketball

Created 2026-11-13T16:16:33+00:00

* tau = 0.4876, d_severe = 0.6876
* w_S = 0.6, w_C = 0.4, C_full = 0.25
* thresholds: Good >= 80, Fair >= 60, Poor >= 40, else Replace
* AUROC healthy vs damaged: None
* Spearman (score vs grade): None
* exact label accuracy: 0.857
* mean score by true grade: {'GOOD': 97.0}

## Confusion matrix

| true \ predicted | GOOD | FAIR | POOR | REPLACE |
|---|---|---|---|---|
| GOOD | 6 | 1 | 0 | 0 |
| FAIR | 0 | 0 | 0 | 0 |
| POOR | 0 | 0 | 0 | 0 |
| REPLACE | 0 | 0 | 0 | 0 |

Measured on the same photos used for fitting - expect slightly lower numbers on new photos.
