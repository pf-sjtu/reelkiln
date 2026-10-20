# Score prompt guide

Use this guide when the user has opted into `score_bed.py --mode generate`.
The gateway's `music` route uses Lyria; a direct raw-key fallback uses ElevenLabs.
Both receive the supplied `--prompt`. The tool adds an instrumental-only instruction.

## Describe the sound, not a recording

Write a short prompt with these details:

- Genre and feel: for example, restrained ambient electronica with a steady pulse.
- Tempo and rhythm: give a BPM or a range and say whether the beat is straight,
  shuffled, sparse, or absent.
- Instruments and roles: identify the low end, harmony, rhythm, and any texture.
  Say when an instrument must stay behind speech rather than take the melody.
- Mood and arc: describe the emotional tone and any change across the bed.
- Function: say it is an instrumental underscore for speech, with no singing,
  lyrics, or prominent lead melody.

Do not name artists, bands, songs, albums, labels, or music services as sonic references.
A platform format description such as "TikTok-ready" is fine when useful.
Do not ask for music "in the style of" or "inspired by" a named work. Lyria may
refuse those references through its content filter. `score_bed.py` rejects
recognizable names and name-shaped reference wording before submission; it cannot
recognize every proper name, so write the prompt in sound terms from the start.

Example:

> Warm downtempo electronica at 82 BPM, soft four-on-the-floor kick and light
> shuffled hi-hats, rounded sub-bass, sustained analog synth chords with no
> lead melody. Calm, curious mood. Keep the texture even under spoken narration;
> make one subtle lift near the end. Instrumental only, no vocals or lyrics.

For a reflective piece, replace the beat with held felt-piano chords, low
strings, and a quiet electronic texture. For a brighter piece, use a gentle
syncopated bass line and brushed drums. Describe these ingredients directly.

## Check the result

Listen for vocals, busy midrange that masks speech, sharp peaks, and a large
intro or outro that cannot serve as an even bed. Reword those musical details
and generate again only when a new paid attempt is authorized. A rejected
content-filter call is not evidence that a specific name caused the refusal
unless the submitted prompt is available for inspection.
