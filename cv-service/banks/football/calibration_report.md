# Calibration report - Football

Created 2026-11-13T07:33:41+00:00

* tau = 0.3809, d_severe = 0.454
* w_S = 0.7, w_C = 0.3, C_full = 0.4
* thresholds: Good >= 85, Fair >= 75, Poor >= 55, else Replace
* AUROC healthy vs damaged: 0.752
* Spearman (score vs grade): 0.737
* exact label accuracy: 0.636
* mean score by true grade: {'GOOD': 93.3, 'FAIR': 100.0, 'POOR': 75.3, 'REPLACE': 37.9}

## Confusion matrix

| true \ predicted | GOOD | FAIR | POOR | REPLACE |
|---|---|---|---|---|
| GOOD | 11 | 0 | 1 | 1 |
| FAIR | 6 | 0 | 0 | 0 |
| POOR | 1 | 1 | 4 | 0 |
| REPLACE | 0 | 0 | 2 | 6 |

Measured on the same photos used for fitting - expect slightly lower numbers on new photos.
