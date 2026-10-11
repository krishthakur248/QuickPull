"""
export_lgbm.py
Run ONCE from the project root to generate the JSON the Node.js ETA engine reads.

    python export_lgbm.py

Output files (all in Model/):
    Model/lgbm_model.json       - full booster dump (Node.js reads this)
    Model/py_golden_preds.json  - Python reference predictions for the verify script
"""

import json, math, os, sys
import joblib
import numpy as np

# ── Paths ──────────────────────────────────────────────────────────────────
ROOT         = os.path.dirname(os.path.abspath(__file__))
MODEL_JOBLIB = os.path.join(ROOT, 'Model', 'LightGBM', 'lgbm_osrm_deployable.joblib')
GOLDEN_JSON  = os.path.join(ROOT, 'Model', 'LightGBM', 'golden_test_cases.json')
OUT_MODEL    = os.path.join(ROOT, 'Model', 'lgbm_model.json')
OUT_PREDS    = os.path.join(ROOT, 'Model', 'py_golden_preds.json')

# ── Load ───────────────────────────────────────────────────────────────────
print('Loading', MODEL_JOBLIB)
bundle  = joblib.load(MODEL_JOBLIB)
model   = bundle['model']          # LGBMRegressor
booster = model.booster_           # underlying Booster

print('  Trees           :', booster.num_trees())
print('  Feature names   :', booster.feature_name())

# ── Dump tree structure to dict ────────────────────────────────────────────
model_dict = booster.dump_model()

# Print key metadata so we know how to traverse in JS
print('  average_output  :', model_dict.get('average_output'))
print('  num_tree_per_it :', model_dict.get('num_tree_per_iteration'))

first_root = model_dict['tree_info'][0]['tree_structure']
print('  Root node keys  :', list(first_root.keys()))
print('  threshold type  :', type(first_root.get('threshold')).__name__)
print('  threshold value :', first_root.get('threshold'))

left_child = first_root.get('left_child', {})
print('  left_child keys :', list(left_child.keys()))

raw_json = json.dumps(model_dict)
print('  JSON size       : {:.1f} KB'.format(len(raw_json) / 1024))

# ── Save the model JSON ────────────────────────────────────────────────────
os.makedirs(os.path.dirname(OUT_MODEL), exist_ok=True)
with open(OUT_MODEL, 'w', encoding='utf-8') as f:
    json.dump(model_dict, f, separators=(',', ':'))
print('Saved ->', OUT_MODEL)

# ── Helper: build 4 features the same way as notebook cell 34 ─────────────
FEATURE_COLUMNS = ['osrm_duration', 'osrm_distance', 'haversine_km', 'osrm_speed_kmh']

def haversine_km(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    a = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2)
    return 6371 * 2 * math.asin(math.sqrt(min(1.0, a)))

def build_features(case_input):
    d   = float(case_input['osrm_duration_s'])
    m   = float(case_input['osrm_distance_m'])
    spd = (m / 1000.0) / (max(d, 1.0) / 3600.0)
    hav = haversine_km(
        case_input['pickup_lat'],  case_input['pickup_lon'],
        case_input['dropoff_lat'], case_input['dropoff_lon']
    )
    return [d, m, hav, spd]

# ── Run all 10 golden cases with the Python booster ───────────────────────
with open(GOLDEN_JSON, encoding='utf-8') as f:
    golden = json.load(f)

print('\n--- Golden test cases (Python booster) ---')
header = '{:<3}  {:>14}  {:>14}  {:>10}  {}'
row    = '{:<3}  {:>14.6f}  {:>14.6f}  {:>10.6f}  {}'
print(header.format('#', 'Expected (s)', 'Python (s)', 'Diff (s)', 'Source'))
print('-' * 65)

max_diff  = 0.0
ref_preds = []
for i, case in enumerate(golden):
    feats  = build_features(case['input'])
    raw    = booster.predict([feats])[0]
    py_eta = float(np.expm1(raw))
    exp    = float(case['expected_eta_seconds'])
    diff   = abs(py_eta - exp)
    max_diff = max(max_diff, diff)
    print(row.format(i + 1, exp, py_eta, diff, case['expected_source']))
    ref_preds.append({
        'case': i + 1,
        'expected_eta_seconds': exp,
        'py_eta_seconds': py_eta,
        'diff': diff,
        'input': case['input']
    })

print()
print('Max difference over 10 cases: {:.8f} s'.format(max_diff))
if max_diff > 0.01:
    print('WARNING: difference is larger than expected — check model file')
    sys.exit(1)
else:
    print('All 10 golden cases pass.')

# ── Save reference predictions for the JS verify script ───────────────────
with open(OUT_PREDS, 'w', encoding='utf-8') as f:
    json.dump(ref_preds, f, indent=2)
print('Reference preds ->', OUT_PREDS)

print()
print('Done. Next step:')
print('  node car-pulling-backend/src/utils/verify_eta_engine.js')
