# Clinical reference

**What this file is.** Every clinical number the system uses is written down here,
with where it comes from. Nothing in the software decides what counts as high blood
pressure, a poorly controlled diabetes result, or a dengue warning sign — those
judgements are made in this file, and the software reads them from it.

**Who this is for.** A clinician reviewing what the system will and will not flag.
You do not need to read any code. If a number here is wrong for your setting, changing
it here changes the system's behaviour.

**Status: awaiting clinical review.** No clinician has reviewed this file. Every entry
below cites published guidance, but the selection and application of those thresholds to
this system has not been signed off by a practising clinician.

**What the system does with these numbers.** It surfaces and ranks. It does not
diagnose, prescribe, or order anything on its own. Every item it raises goes to a
clinician who decides.

**When a case falls outside this file.** The system says the assessment is uncertain
and marks its confidence as low. It never invents a threshold to cover a gap.

---

## How to read the tables

Each row is one rule. `ID` is how the software refers to the rule — when the system
explains why it flagged a patient, it points back to these IDs so any flag can be traced
to a specific published source.

---

## 1. Blood pressure

Source: **2017 ACC/AHA Guideline for the Prevention, Detection, Evaluation, and
Management of High Blood Pressure in Adults** (Whelton et al., *Hypertension*, 2018).

| ID | Rule | Value | Meaning |
|---|---|---|---|
| `BP-NORMAL` | Normal | below 120 systolic and below 80 diastolic | No concern |
| `BP-ELEVATED` | Elevated | 120–129 systolic and below 80 diastolic | Lifestyle advice |
| `BP-STAGE1` | Stage 1 hypertension | 130–139 systolic or 80–89 diastolic | Treatment considered |
| `BP-STAGE2` | Stage 2 hypertension | 140 systolic or above, or 90 diastolic or above | Treatment indicated |
| `BP-CRISIS` | Hypertensive crisis | above 180 systolic or above 120 diastolic | Needs attention today |

## 2. Diabetes

Source: **American Diabetes Association, Standards of Care in Diabetes** — glycaemic
targets and assessment.

| ID | Rule | Value | Meaning |
|---|---|---|---|
| `HBA1C-TARGET` | Glycaemic goal for most non-pregnant adults | below 7.0 percent | At goal |
| `HBA1C-ABOVE-TARGET` | Above goal | 7.0 to 8.9 percent | Treatment review |
| `HBA1C-POOR` | Poor control | 9.0 percent or above | Needs attention |
| `HBA1C-INTERVAL-STABLE` | Testing interval when at goal and stable | every 6 months | Overdue after this |
| `HBA1C-INTERVAL-UNSTABLE` | Testing interval when above goal or after a therapy change | every 3 months | Overdue after this |

## 3. Kidney monitoring in diabetes

Source: **American Diabetes Association, Standards of Care in Diabetes** — chronic
kidney disease and risk management.

| ID | Rule | Value | Meaning |
|---|---|---|---|
| `ACR-INTERVAL` | Urine albumin-to-creatinine testing in type 2 diabetes | at least once a year | Overdue after this |
| `ACR-ABNORMAL` | Raised urine albumin-to-creatinine ratio | 30 mg/g or above | Albuminuria present |
| `EGFR-INTERVAL` | Estimated glomerular filtration rate testing | at least once a year | Overdue after this |
| `EGFR-REDUCED` | Reduced kidney function | below 60 mL/min/1.73m² | Kidney disease staging applies |

## 4. Dengue

Source: **World Health Organization, Dengue: Guidelines for Diagnosis, Treatment,
Prevention and Control** (2009), warning signs and severity classification.

The critical phase, when a patient can deteriorate quickly, is typically **days 3 to 7**
after fever begins — often as the fever settles rather than while it is highest.

| ID | Rule | Value | Meaning |
|---|---|---|---|
| `DENGUE-CRITICAL-WINDOW` | Critical phase | days 3 to 7 of illness | Close observation |
| `DENGUE-WARNING-SIGNS` | Warning signs | abdominal pain or tenderness; persistent vomiting; fluid accumulation; mucosal bleeding; lethargy or restlessness; liver enlargement beyond 2 cm; rising haematocrit with a rapidly falling platelet count | Any one means dengue with warning signs |
| `DENGUE-PLATELET-LOW` | Falling platelet count | below 100 ×10⁹/L | Component of the warning-sign pattern above |
| `DENGUE-PLATELET-CRITICAL` | Marked thrombocytopenia | below 50 ×10⁹/L | Bleeding risk |

**Note on how this is applied.** A low platelet count on its own is not a warning sign
in the WHO classification — it counts when it is falling rapidly alongside a rising
haematocrit. The system follows the guideline on this point and does not flag an isolated
platelet value as a warning sign.

## 5. Sickle cell disease

Source: **National Heart, Lung, and Blood Institute, Evidence-Based Management of
Sickle Cell Disease: Expert Panel Report** (2014).

| ID | Rule | Value | Meaning |
|---|---|---|---|
| `SCD-FEVER` | Fever in sickle cell disease | 38.5 °C or above | Medical emergency; risk of serious infection because the spleen does not work normally |
| `SCD-HYDROXYUREA` | Hydroxyurea should be discussed | 3 or more severe pain crises in 12 months | Treatment review |
| `SCD-CRISIS-PATTERN` | Rising crisis frequency | more crises in the last 12 months than the 12 months before | Trend worth acting on |

## 6. Follow-up intervals

Source: general chronic disease management practice, consistent with the monitoring
intervals cited above. These govern only whether a patient is *overdue to be seen*; they
carry no diagnostic meaning on their own.

| ID | Rule | Value | Meaning |
|---|---|---|---|
| `FOLLOWUP-CHRONIC-UNCONTROLLED` | Chronic condition not at target | every 3 months | Overdue after this |
| `FOLLOWUP-CHRONIC-STABLE` | Chronic condition at target | every 6 months | Overdue after this |
| `FOLLOWUP-NO-CHRONIC` | No chronic condition on the problem list | every 12 months | Overdue after this |

---

## 7. Symptom associations used to pull up relevant history

**These are not diagnostic criteria.** They are not used to decide what a patient
has. They are used only to decide *which past visits to show the clinician* when a
new note mentions a symptom — so that a note about breathlessness brings up the
heart-related visits rather than the whole chart.

Getting one of these wrong means the wrong past visit is surfaced, which the
clinician will see and can correct. It does not cause anything to be flagged,
ranked, or ordered.

| Symptom mentioned in a note | Past visits pulled up |
|---|---|
| Breathlessness, shortness of breath, exertional dyspnoea | Atrial fibrillation, heart failure, anaemia, sickle cell disease |
| Chest pain, palpitations | Atrial fibrillation, hypertension |
| Painful crisis, bone pain, limb pain | Sickle cell disease |
| Fever with headache, joint or muscle aches, rash | Dengue fever |
| Headache, visual disturbance | Hypertension |
| Thirst, passing urine often, blurred vision, foot ulcer | Type 2 diabetes mellitus |
| Ankle swelling, reduced urine output | Chronic kidney disease, heart failure |
| Tiredness, feeling cold, weight gain | Hypothyroidism, anaemia |
| Joint pain and stiffness on movement | Osteoarthritis |

## 8. Units that must be stated

Some measurements are written in more than one unit in everyday practice. When a
note gives one of these as a bare number, the system flags the field for the
clinician rather than assuming which unit was meant.

| Measurement | Units in common use | Bare number is |
|---|---|---|
| Weight | kilograms, pounds | Ambiguous — flagged |
| Temperature | degrees Celsius, degrees Fahrenheit | Ambiguous — flagged |
| Blood glucose | mmol/L, mg/dL | Ambiguous — flagged |
| Height | centimetres, feet and inches | Ambiguous — flagged |
| Blood pressure | mmHg only | Unambiguous — accepted |
| HbA1c | percent (values roughly 4–15), mmol/mol (values roughly 20–140) | Accepted when the value can only be one of the two |
| Haemoglobin | g/dL | Unambiguous — accepted |
| Platelet count | ×10⁹/L | Unambiguous — accepted |
| Heart rate | beats per minute | Unambiguous — accepted |

---

## What is deliberately not covered

The system has no encoded rules for anything outside the sections above. Asthma, mental
health, pregnancy, paediatrics, cancer, and acute surgical presentations are all outside
its scope. When a patient's picture depends on one of those, the system says its
assessment is uncertain rather than guessing.
