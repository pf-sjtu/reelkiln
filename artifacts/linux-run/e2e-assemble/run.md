# Run log — `linux-e2e-20261020-a1b2c3`

_Auto-generated from `run.log.jsonl`. Do not edit by hand._


_5 events across 2 tools._


## Timeline

| Time | Tool | Event | Duration | Notes |
|------|------|-------|----------|-------|
| 23:15:15 | assemble.py | beat_assembled |  |  |
| 23:15:15 | assemble.py | beat_assembled |  |  |
| 23:15:15 | assemble.py | beat_assembled |  |  |
| 23:15:15 | assemble.py | timeline_assembled | 3.2s |  |
| 23:15:20 | verify_output.py | verify_complete |  |  |

## Detail by tool


### `assemble.py`


**[23:15:15] beat_assembled** (`8172d10b1d`)
- `end_sec`: 2.0
- `name`: b1_hook

<details><summary>prompt</summary>

```
None
```
</details>


<details><summary>response</summary>

```
None
```
</details>

- `source`: broll/clip_a.mp4
- `source_kind`: real
- `start_sec`: 0.0
- `usage_role`: broll


**[23:15:15] beat_assembled** (`3c318798ff`)
- `end_sec`: 3.5
- `name`: b2_card

<details><summary>prompt</summary>

```
None
```
</details>


<details><summary>response</summary>

```
None
```
</details>

- `source`: images/card.png
- `source_kind`: other
- `start_sec`: 2.0
- `usage_role`: card


**[23:15:15] beat_assembled** (`2cd0f7f5f0`)
- `end_sec`: 5.5
- `name`: b3_broll

<details><summary>prompt</summary>

```
None
```
</details>


<details><summary>response</summary>

```
None
```
</details>

- `source`: broll/clip_b.mp4
- `source_kind`: real
- `start_sec`: 3.5
- `usage_role`: broll


**[23:15:15] timeline_assembled** (`e4f64e5e9a`)
- `beats`: 3
- `duration_seconds`: 3.18
- `estimate_usd`: 0.0
- `from_beats`: False
- `output`: final_raw.mp4
- `output_sha256`: 669ff565a825ad70befe41080585e7d6701c96fccdec446762acb3b63ba423b2

<details><summary>prompt</summary>

```
None
```
</details>


<details><summary>response</summary>

```
None
```
</details>

- `total_sec`: 5.5


### `verify_output.py`


**[23:15:20] verify_complete** (`02a44a30ad`)
- `avatar_type`: synthetic_avatar
- `avatar_type_reason`: default (no markers found)
- `blocking`: ```json
[]
```
- `input`: final_raw.mp4
- `mode`: render

<details><summary>prompt</summary>

```
None
```
</details>


<details><summary>response</summary>

```
None
```
</details>

- `status`: OK
- `usage_role`: render

