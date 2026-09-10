# Satellite ML Dataset Quality Audit Report

**Audit Status:** `FAILED`  
**Total Samples:** 949  
**Leakage Check:** `FAILED`

---

## 1. Class Distribution
| Class | Sample Count | Percentage |
| :--- | :--- | :--- |
| `WILDFIRE` | 349 | 36.8% |
| `NON_FIRE` | 350 | 36.9% |
| `INDUSTRIAL_FIRE` | 250 | 26.3% |

---

## 2. Label Type Distribution
| Label Type | Count | Percentage | Description |
| :--- | :--- | :--- | :--- |
| `GROUND_TRUTH` | 699 | 73.7% | Verified reference fire/background events |
| `WEAK_LABEL` | 250 | 26.3% | Algorithmic FIRMS + OSM proximity pairings |
| `MANUAL_REVIEW` | 0 | 0.0% | Human-inspected and confirmed |

---

## 3. Dataset Splits & Leakage Audit
- **Train Split:** 673 (70.9%)
- **Validation Split:** 130 (13.7%)
- **Test Split:** 146 (15.4%)
- **Spatial Overlap Issues:** 3

---

## 4. Cloud Quality Distribution
- **0–10% Cloud Cover:** 388 samples
- **10–30% Cloud Cover:** 465 samples
- **30–60% Cloud Cover:** 96 samples
- **>60% Cloud Cover:** 0 samples

---

## 5. Audit Details
- **Errors (4):** Found 490 missing image files., Train/Val spatial cluster overlap (17 clusters): ['cluster_36.00_28.00', 'cluster_21.50_81.50', 'cluster_24.50_83.00'], Train/Test spatial cluster overlap (20 clusters): ['cluster_21.50_81.50', 'cluster_21.00_85.00', 'cluster_21.00_85.50'], Val/Test spatial cluster overlap (15 clusters): ['cluster_36.00_28.00', 'cluster_21.50_81.50', 'cluster_21.00_72.50']
- **Missing Images:** 490
- **Corrupted Files:** 0
