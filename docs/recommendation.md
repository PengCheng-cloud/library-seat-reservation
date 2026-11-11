# Seat recommendation: what the model learns, what the reasons say, how fast it answers

This document adds three things that the thesis did not look at:

1. [Where the labels come from](#where-the-labels-come-from) and what the reported
   Macro-F1 of 0.91 therefore means.
2. [Whether the reasons shown to the reader match what the model uses](#do-the-reasons-match-the-model).
3. [How long a prediction takes](#latency) and how the backend now calls the model.

All numbers can be reproduced:

```bash
pip install -r scripts/requirements.txt
python scripts/build_matching_recommendation_pipeline.py   # dataset and models, about 5 minutes
python scripts/explanation_faithfulness.py                 # section 2, about 1 minute
cd server && npm run bench:inference                       # section 3
```

## Where the labels come from

There is no log of real readers choosing seats. The dataset is built from 56 written
requirements and the 1,772 real seats of the library:

- For every pair (requirement, seat), hand-written rules compute four scores from the seat
  properties and the stated preferences: focus, comfort, device work, collaboration
  (`calculate_scene_match_scores`).
- A pair gets a label if its score is in the top share of the seats for that requirement.
  Labels close to the threshold are flipped at random, and a few hard exceptions are
  applied (`apply_fuzzy_multilabels`).
- The four rule scores are also among the 68 input features (`score_*_match`).

So the classifier learns to reproduce a noisy version of rules that I wrote myself, and
it is given the main ingredient of those rules as input. **The Macro-F1 of 0.91 says how
well the SVM recovers the rule-based labels on requirements it has not seen. It does not
say that readers are satisfied with the recommended seats.** Measuring that would need
real usage data, which the project does not have.

Without the four rule-score features the same SVM reaches a Macro-F1 of 0.75 instead of
0.91 on the same test split.

## Do the reasons match the model?

Next to a recommended seat the Mini Program shows a reason such as "matches: power outlet,
quiet". The reason is assembled from the preference-match features (`match_power_outlet`,
`match_quiet`, ...): a preference is named when the reader asked for it and the seat has
it. It was never checked whether the model relies on these features.

The deployed model is one linear SVM per label (StandardScaler + LinearSVC). For a linear
model the contribution of each feature to a score is exact, `w_j · (x_j − mean_j) / scale_j`,
so no approximation method is needed.

Setup: 80/20 split by requirement (11 test requirements, 6,721 test pairs), the top-5
recommended seats of every test requirement (55 seats). On average a reason names 3.7
features.

| Measure | Deployed model |
|---|---:|
| Share of the positive contribution that comes from the features named in the reason | 3 % |
| Seats where the strongest contributor is a named feature | 0 of 55 |
| Overlap of the three strongest contributors with the named features | 6 % |
| Score drop when the named features are removed | 0.07 |
| Score drop when the same number of strongest contributors is removed | 0.78 |
| Score drop when the same number of random features is removed | 0.02 |

(The score is the weighted match score between 0 and 1 that ranks the seats. "Removed"
means set to the training mean, which makes the contribution zero.)

The strongest contributor was `score_focus_match` for 30 seats, `score_comfort_match` and
`score_device_match` for 10 each, and `need_power_outlet` for 5.

Permutation importance by feature group on the test set (drop of Macro-F1 from 0.91 when
the group is shuffled):

| Feature group | Features | Macro-F1 drop |
|---|---:|---:|
| rule scores (`score_*_match`) | 4 | 0.68 |
| requirement (`need_*`, `scene_*`, time) | 19 | 0.46 |
| preference matches (`match_*`), named in the reason | 10 | 0.37 |
| conflicts and synergies | 9 | 0.25 |
| seat properties (`seat_*`) | 12 | 0.16 |
| zone and table-group statistics | 15 | 0.15 |

**Result: the reasons are not a faithful explanation of the model.** They read plausibly,
because the named preferences are inputs of the rule scores. But for the recommended
seats the model's score is carried almost entirely by the rule scores themselves, and
removing the named features changes it only a little more than removing random features.
The reason describes the seat correctly; it does not describe why the model ranked it
first.

For comparison, the model trained without the rule scores:

| Measure | Without rule scores |
|---|---:|
| Macro-F1 | 0.75 |
| Share of the positive contribution from the named features | 27 % |
| Seats where the strongest contributor is a named feature | 15 of 55 |
| Score drop when the named features are removed | 0.29 |
| Score drop when the same number of strongest contributors is removed | 0.47 |

Its reasons are closer to what it uses, but it fits the labels worse. Since the labels are
derived from the rule scores, this is expected.

What changed in the code: the API answer for every recommended seat now also carries
`modelEvidence`, the three features with the largest contribution and their share,
computed from the weights of the model (`build_model_evidence` in
`scripts/realtime_svm_predict.py`). The text reason is unchanged and the Mini Program does
not show the new field yet.

Limits of this analysis: 11 test requirements are few, and the five best seats of one
requirement are often neighbours at the same table with almost the same features, so the
55 seats are far from independent. The contributions are exact for the linear score
before the sigmoid; the score shown to the reader is additionally adjusted by explicit
match and conflict ratios (`calibrate_online_match_probability`), which this analysis
leaves out.

## Latency

The first implementation started a new Python process for every recommendation request.
Each process imported pandas and scikit-learn, loaded the model and built the profiles of
all 1,772 seats before it predicted anything.

The backend now keeps one Python worker (`realtime_svm_predict.py --serve`) that does this
once and then answers one JSON request per line
([`server/src/lib/svm-runtime-inference.js`](../server/src/lib/svm-runtime-inference.js)).
If the worker cannot be started or dies, the request is answered by a one-shot process and
the next request starts a new worker.

`npm run bench:inference`, same machine as in [database.md](database.md), time for one
request as seen by the Node.js backend:

| Candidate seats | New process per request (p50, 5 runs) | Worker (p50 / p95, 30 runs) |
|---:|---:|---:|
| 20 | 1,845 ms | 23 ms / 32 ms |
| 200 | 1,954 ms | 148 ms / 191 ms |
| 1,772 (all) | 2,899 ms | 1,051 ms / 1,150 ms |

The benchmark also checks that both ways return identical seats and scores.

The recommendation endpoint of the app (`POST /api/assistant/seat`) scores all bookable
seats of the library, so it is the last row that matters there. Measured over HTTP, a
request took about 3.1 s before and about 1.25 s with the worker.

About 1.8 seconds of every request were start-up cost. What remains grows with the number
of seats, about 0.6 ms per seat: the features of every (requirement, seat) pair are built
in a Python loop, one seat at a time. Building them as arrays for all seats at once would
be the next step; I have not done it.

The worker handles one request at a time. That is enough for this project, but several
simultaneous recommendation requests wait for each other.
