# Third-party notices — HyperFrames render layer

The HyperFrames render layer combines components under **different** licenses.
It is **not** all Apache-2.0. Review before relying on this in production —
issue #112 is licensing-driven, so the GSAP item in particular needs legal
confirmation.

| Component | Where | License | Notes |
|---|---|---|---|
| **HyperFrames** (`hyperframes` CLI) | npm dependency (`hyperframes/package.json`, not vendored) | **Apache-2.0** | The renderer itself. Installed via `npm install`; not redistributed in this repo. |
| **GSAP** 3.14.2 | vendored — `runtime/gsap.min.js` | **GSAP Standard License** (Webflow, "no charge"; NOT Apache-2.0) | Animation runtime. See note below. |
| **Inter** (variable, Latin) | vendored — `runtime/fonts/inter-variable.woff2` | **SIL Open Font License 1.1** | Copyright The Inter Project Authors (https://github.com/rsms/inter). |
| **JetBrains Mono** (variable, Latin) | vendored — `runtime/fonts/jetbrains-mono-variable.woff2` | **SIL Open Font License 1.1** | Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono). |

## GSAP — separate license (engine-side render appears within permitted uses; editor is a later question)

`runtime/gsap.min.js` is **GSAP 3.14.2**, used under the **GSAP Standard License**
(https://gsap.com/community/standard-license/, effective 2025, Webflow, Inc.).
This is a *different* license from HyperFrames' Apache-2.0 and the fonts' OFL.
The retained file header in `gsap.min.js` is part of the license and **must not
be removed**.

How we read the current Standard License (our reading, NOT a legal opinion —
read the source before relying on it):

- **Permitted Uses (as we read the current text)**: use of GSAP on a website,
  web application, or digital interface. We did not find a team-size or revenue
  restriction in the license text.
- **Prohibited Uses**: using GSAP inside a tool that lets users **build visual
  animations without code** in a way that competes with Webflow's visual
  animation-building capability. AI-generated code is explicitly *not* a
  prohibited use.

**Engine-side rendering (this PR): appears to fall within the listed permitted
uses.** videoclaw uses GSAP server-side to generate/render finished MP4s. It
ships no no-code animation builder to end users, so the competing-editor carve-out
does not obviously apply. This is our reading, not a legal opinion —
organizational/legal confirmation is still recommended before relying on it in
production.

**A future in-app editor is a separate question.** If videoclaw later ships a
visual editor that lets users build/manipulate animations without code, that
could implicate the competing-product clause and warrants its own license review
at that time (a `videoclaw-app` phase, out of scope here). This is *not legal
advice* — it flags what the current license text says.

## Apache-2.0 (HyperFrames)

HyperFrames is distributed under the Apache License, Version 2.0
(https://www.apache.org/licenses/LICENSE-2.0). Full terms ship with the
installed package under `hyperframes/node_modules/hyperframes/`.

## SIL Open Font License, Version 1.1 (Inter, JetBrains Mono)

```
Copyright (c) The Inter Project Authors.
Copyright (c) 2020 The JetBrains Mono Project Authors.

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://openfontlicense.org

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply to any
document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may include
source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical writer or
other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining a
copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components, in
Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or in
the appropriate machine-readable metadata fields within text or binary
files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name
as presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any Modified
Version, except to acknowledge the contribution(s) of the Copyright
Holder(s) and the Author(s) or with their explicit written permission.

5) The Font Software, modified or unmodified, in part or in whole, must be
distributed entirely under this license, and must not be distributed under
any other license. The requirement for fonts to remain under this license
does not apply to any document created using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are not
met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER DEALINGS
IN THE FONT SOFTWARE.
```
