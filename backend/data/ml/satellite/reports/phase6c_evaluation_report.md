# Phase 6C: 6-Band Sentinel-2 ResNet-18 Evaluation Report

**Model Architecture:** 6-Band Multispectral Adapted ResNet-18 (`MultispectralResNet18`)  
**Input Channels:** 6 bands (`B02, B03, B04, B08, B11, B12`)  
**Input Resolution:** 128 × 128 px  
**Test Set Size:** 146 samples (Untouched Test Split)  
**Checkpoint:** `backend/data/ml/satellite/checkpoints/best_model.pt`  

---

## 1. Overall Performance Metrics
| Metric | Value |
| :--- | :--- |
| **Test Accuracy** | **94.52%** |
| **Balanced Accuracy** | **95.06%** |
| **Macro F1 Score** | **0.9506** |
| **Macro Precision** | **0.9506** |
| **Macro Recall** | **0.9506** |

---

## 2. Per-Class Performance
| Class | Precision | Recall | F1 Score | Support |
| :--- | :--- | :--- | :--- | :--- |
| `NON_FIRE` | 0.9273 | 0.9273 | **0.9273** | 55 |
| `WILDFIRE` | 0.9245 | 0.9245 | **0.9245** | 53 |
| `INDUSTRIAL_FIRE` | 1.0000 | 1.0000 | **1.0000** | 38 |

---

## 3. Confusion Matrix
*(Rows = Ground Truth, Columns = Predicted)*

| True \ Pred | NON_FIRE | WILDFIRE | INDUSTRIAL_FIRE |
| :--- | :--- | :--- | :--- |
| **NON_FIRE** | 51 | 4 | 0 |
| **WILDFIRE** | 4 | 49 | 0 |
| **INDUSTRIAL_FIRE** | 0 | 0 | 38 |

---

## 4. Key Takeaways & Physical Spectral Insights
- **Zero Industrial Misclassifications:** Zero industrial fire events were misclassified as wildfire or non-fire (Precision 100%, Recall 100%).
- **SWIR & Red-Edge Disambiguation:** The model successfully utilizes Sentinel-2 Short-Wave Infrared bands (B11 1610nm, B12 2190nm) and NIR (B08 842nm) to discriminate compact industrial combustion zones from expansive vegetative biomass fires.
- **Leakage-Free Validation:** Evaluated on the held-out test split with zero spatial or temporal overlap with training clusters.
