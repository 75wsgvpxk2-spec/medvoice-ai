# MedVoice AI — Clinical Command Room Build Specification
## Codex Implementation Prompt

### Purpose

Transform the existing MedVoice AI frontend from a traditional sidebar-and-page clinical application into a **light, blue, spatial “Clinical Command Room” experience** while preserving the existing clinical logic, workflows, APIs, safety boundaries, and mature detail screens.

The reference images attached to this specification define the desired visual direction.

This is **not** a complete rewrite of MedVoice AI.

The core concept is:

> **The 3D room becomes the operating system. The existing MedVoice UI becomes the trusted detail / focus layer.**

The user should feel like they are operating a futuristic clinical workspace rather than navigating a SaaS dashboard.

---

# 1. Primary Design Goal

MedVoice AI should no longer feel like:

`Sidebar → Page → Tab → Form`

It should feel like:

`Doctor enters room → asks / points / clicks → the room brings the correct clinical information forward`

The interface should be:

- spatial
- voice-first
- object-driven
- calm
- medical
- light
- blue and white
- premium
- futuristic without looking like a video game
- clinically trustworthy
- easy to fall back into conventional UI when precision is required

Do **not** turn the product into a first-person game.

Do **not** require WASD movement.

Do **not** force the clinician to manually walk around the room.

Navigation should use:

- click/tap
- voice
- smooth camera transitions
- optional keyboard shortcuts
- optional gesture support later

---

# 2. Current Application Structure to Preserve

The current frontend already contains the core screens and workflows. Reuse them rather than rebuilding all functionality from scratch.

Important existing routes/screens include:

- Dashboard
- Priority Queue
- All Patients / Population
- Patient Detail
- New Encounter
- Flags
- Agent Activity
- Audit Trail
- Operations
- HSE / Forms
- Settings
- Clinic Profile

Important existing components / concepts include:

- live-updating clinical priority queue
- risk status: critical / watch / managed / stable
- patient longitudinal record
- voice-first encounter dictation
- clinician review before approval
- four named AI agents
- guideline-backed clinical reference IDs
- documentation alerts
- care gaps
- orders
- encounter history
- operations: forms, products, invoices, expenses, reports
- auditability
- clinician approval boundaries

Preserve these concepts.

---

# 3. Core Architecture

Create two top-level UI modes.

## A. ROOM MODE

The default experience.

A persistent 3D clinical command room acts as the main navigation and information surface.

Use this for:

- home / landing state
- triage
- patient discovery
- overview
- asking Astra questions
- starting workflows
- monitoring the caseload
- selecting the active patient
- opening clinical tools

## B. FOCUS MODE

A high-legibility 2D interface displayed as:

- floating glass panel
- desk monitor
- wall screen
- document sheet
- full-screen overlay

Use this for:

- editing SOAP notes
- correcting ambiguous fields
- approving encounters
- resolving clinical alerts
- detailed operations forms
- financial data entry
- settings
- audit inspection
- any workflow where accuracy matters more than spectacle

The 3D room must never make a critical clinical workflow harder to use.

---

# 4. Proposed Frontend Structure

Suggested structure:

```text
client/src/
  command-room/
    CommandRoom.tsx
    RoomScene.tsx
    CameraController.tsx
    AstraCore.tsx
    TriageWall.tsx
    FilingCabinet.tsx
    PatientHologram.tsx
    DoctorDesk.tsx
    DocumentationInbox.tsx
    MedicalLibrary.tsx
    CareCalendar.tsx
    AuditArchive.tsx
    OperationsComputer.tsx
    CommandRoomHUD.tsx
    roomState.ts
    roomActions.ts
    roomConfig.ts

  focus/
    FocusLayer.tsx
    FloatingPanel.tsx
    MonitorSurface.tsx
    ModalSurface.tsx
```

Do not immediately move all existing screens.

Instead, wrap existing screen components inside the new focus layer.

---

# 5. Recommended 3D Stack

Use:

- Three.js
- React Three Fiber
- Drei

Optional later:

- GSAP or Framer Motion for UI transitions
- Web Audio API for subtle interface sound
- MediaPipe / hand tracking for gesture experiments

Avoid adding unnecessary heavy dependencies.

Performance matters more than visual excess.

---

# 6. Visual Language

The reference images define the intended direction.

## Palette

Primary:

- white
- very light blue
- soft sky blue
- medium MedVoice blue
- dark navy text

Secondary:

- glass transparency
- subtle silver
- very pale cyan

Clinical urgency colors remain semantically reserved:

- red = critical
- amber/orange = watch / due
- green = stable / complete
- blue = neutral / information

Do not recolor urgency states just to fit the room.

## Materials

Use:

- frosted glass
- matte white surfaces
- subtle metallic trims
- soft emission edges
- clean architectural curves
- light reflective flooring
- large windows
- calm daylight

Avoid:

- black cyberpunk environments
- purple neon overload
- heavy sci-fi textures
- clutter
- spaceship aesthetics
- gaming HUD overload

The room should feel like:

> “A premium future hospital command workspace”

not:

> “A sci-fi game lobby”

---

# 7. Main Room Layout

Create one persistent room with clear spatial landmarks.

## Left / Front Left
### Clinical Priority Queue

Large wall-mounted triage display.

This is one of the most important room objects.

Shows:

- rank
- patient
- age/sex
- reason for attention
- urgency
- care gap / alert information

The priority queue should visibly reorder when updated.

Animation:

- cards smoothly slide vertically
- changed rank briefly glows
- newly urgent patient receives a subtle pulse
- no dramatic flashing

Clicking a patient:

1. selects patient
2. camera eases toward the patient hologram zone
3. active patient loads into the central clinical workspace

Voice examples:

- “Show today’s priorities”
- “Who needs attention first?”
- “Open Maria Joseph”
- “Show critical patients”

---

# 8. Patient Filing Cabinet

## Purpose

Spatial replacement for “All Patients”.

Represent patient records as physical folders within a clinical records wall.

This should still use the current patients API / filters.

## Capabilities

Support:

- search by name
- filter by status
- filter by condition
- sort
- never assessed
- recently viewed

Voice examples:

- “Open patient records”
- “Find Maria Joseph”
- “Show diabetic patients”
- “Show patients who have never been assessed”
- “Show hypertensive patients”

## Animation

When a patient is selected:

- folder subtly illuminates
- folder slides forward
- patient summary card appears
- confirm selection
- folder / data moves toward the patient station

Do not animate dozens of folders individually every frame.

Use instancing / lightweight geometry where possible.

---

# 9. Active Patient Hologram

This is the visual centerpiece of the patient experience.

When a patient is selected, the center of the room changes from idle Astra state to an **active patient clinical visualization**.

## Core Elements

Center:

- stylized human silhouette / hologram
- not medically photorealistic
- not a diagnostic anatomical model
- simple clinical digital twin metaphor

Around the patient:

- vitals
- labs
- medications
- risk flags
- care gaps
- encounters
- documents
- relevant conditions

## Interaction

Click any module to expand it.

Voice examples:

- “What changed since the last visit?”
- “Show recent labs”
- “Show medications”
- “What are the active risks?”
- “Why is this patient critical?”
- “Show encounter history”
- “Show care gaps”

## Important

The visual should summarize the existing patient record.

Do not invent new clinical conclusions.

Use existing MedVoice output.

---

# 10. Risk Flag Visualization

Existing risk flags should become spatial cards.

Each risk card should preserve:

- urgency
- reasoning
- recommended action
- confidence
- reference IDs

Clicking “Why?” or asking a voice question should expand the rationale.

If a reference ID exists, provide:

- “View source”
- “Open guideline”
- “Show basis”

The guideline can visually travel from the Medical Library to the active patient workspace.

The clinical system should visibly communicate:

> “This is what the AI found, and this is what it used.”

---

# 11. Medical Library

Represent the clinical reference system as a physical / spatial medical library.

This is not decoration.

It represents the existing guideline-backed rule system.

## Content

Allow access to:

- Diabetes
- Hypertension
- CKD
- Cardiac care
- Sickle cell
- Dengue
- other supported references

When a risk flag references a threshold:

1. highlight the relevant guideline
2. open a focused rule card
3. show:
   - rule name
   - published threshold
   - patient value
   - reference ID
   - short source description

Voice examples:

- “Why is this above target?”
- “Which guideline are you using?”
- “Show the diabetes target”
- “What rule triggered this?”

---

# 12. Astra Core

Astra is the persistent AI presence.

Do not implement Astra as a bottom-right chat bubble.

## Visual

Use a floating glowing orb / circular core.

States:

- idle
- listening
- thinking
- speaking
- acting
- error

## Motion

Idle:
- subtle breathing

Listening:
- waveform or expanding ring

Thinking:
- inward particles / slow pulse

Acting:
- visible connection line to the room object being controlled

Error:
- calm error state, not panic animation

## Role

Astra acts as:

- conversational navigation
- room controller
- clinical assistant
- workflow launcher
- summarizer

Astra must not bypass clinician approval.

---

# 13. Four AI Agents

The repo already contains four named AI agents.

Expose them visually.

Agents:

1. Intake and Context
2. Record Structuring
3. Clinical Intelligence
4. Documentation and Compliance

Do not turn them into cartoon characters.

Represent them as:

- small light modules
- rings
- nodes
- labeled lanes
- status indicators around Astra

During encounters, visibly show:

```text
Intake and Context
      ↓
Record Structuring
      ↓
Clinical Intelligence
      ↓
Documentation and Compliance
```

or the actual current execution sequence where applicable.

Statuses:

- waiting
- working
- done
- failed

Preserve current behavior where failures are reported rather than hidden.

---

# 14. Voice-First Encounter

This should be one of the strongest demo flows.

## Entry

Doctor selects active patient and says:

> “Start an encounter.”

The camera moves to the doctor’s desk / encounter station.

## During Dictation

Show:

- Astra listening state
- live transcript
- timer
- selected patient
- small live extraction indicators

Possible detected items:

- symptoms
- vitals
- medications
- follow-up discussion
- observations

Do not display AI conclusions before the current backend actually produces them.

## Finish

Doctor says:

> “Finish encounter.”

Then visually show agent processing.

## Review

Once processing completes:

- Focus Mode opens
- structured SOAP note is displayed
- ambiguous fields remain clearly marked
- clinician can edit
- original note remains accessible
- clinician must explicitly approve

Preserve:

`Approve and save`

as a real clinician decision.

Do not auto-approve.

---

# 15. Doctor’s Desk

The desk is the bridge between futuristic Room Mode and practical Focus Mode.

The desk contains:

- primary computer
- microphone / encounter control
- documentation inbox
- clipboard / notes
- forms output

When a detailed workflow begins, move the camera toward the desk and bring a flat readable interface forward.

---

# 16. Operations Computer

The Operations area should feel like an actual clinic computer inside the room.

Use the current operations routes.

Existing modules include:

- Forms
- Products
- Invoices
- Expenses
- Reports
- Settings / related operations controls

The screen itself may remain mostly conventional.

That is intentional.

This shows that the Command Room sits on top of a real operating system.

## Behavior

Room Mode:
- click Operations computer
- camera zooms toward monitor

Focus Mode:
- existing Operations screen is shown

Back:
- smoothly return to room

---

# 17. Documentation Inbox

Represent unresolved documentation work as a physical inbox / smart tray.

Display:

- open documentation alerts
- missing results
- missing diagnosis
- incomplete note
- billing / coding gaps where applicable

Clicking the inbox:

- cards fan out or appear as a focused stack

Voice examples:

- “What needs documentation?”
- “Show my inbox”
- “What is still unresolved?”
- “Show missing results”

Resolution should still occur through the existing alert workflow.

---

# 18. Care Gap Calendar

A wall calendar / spatial calendar represents:

- overdue follow-ups
- overdue monitoring
- care gaps
- due reviews

Visual states:

- blue = scheduled / neutral
- orange = due
- red = overdue / critical where appropriate
- green = completed

Voice examples:

- “Who is overdue?”
- “Show follow-ups this week”
- “Show diabetic reviews”
- “Who needs monitoring?”

This can initially be a visual surface backed by current care-gap data.

Do not invent a scheduling backend if one does not exist.

---

# 19. Audit Archive

Represent the Audit Trail as a secure archive / locked glass panel.

Room object:
- minimal
- secure
- calm
- intentionally less flashy

When opened:

- switch to Focus Mode
- show existing Audit Trail

Conceptual message:

> “Every important action leaves a trace.”

Do not modify the underlying audit behavior.

---

# 20. Global Room HUD

Keep the room mostly clean.

A minimal persistent HUD may contain:

Top:

- clinic name
- logged-in clinician
- current date/time
- demo-data indicator
- connectivity / agent status
- global search / ask Astra

Avoid rebuilding the current sidebar as a floating sidebar.

The room objects themselves should be the navigation.

---

# 21. Camera Behavior

Camera movement is part of the UX.

Use named camera anchors.

Example:

```ts
type CameraAnchor =
  | 'home'
  | 'triage'
  | 'patients'
  | 'patient'
  | 'desk'
  | 'operations'
  | 'library'
  | 'calendar'
  | 'audit'
```

Transitions should:

- ease in/out
- last approximately 500–900ms
- never induce motion sickness
- avoid rapid spinning
- keep a fixed horizon
- use subtle depth-of-field only if performance allows

Allow a “Reduce motion” mode.

---

# 22. Room State

Suggested state:

```ts
interface CommandRoomState {
  mode: 'room' | 'focus'
  activeAnchor: CameraAnchor
  activePatientId: string | null
  activeFocusRoute: Route | null
  astraState: 'idle' | 'listening' | 'thinking' | 'speaking' | 'acting' | 'error'
  selectedRoomObject: string | null
}
```

Existing route behavior should remain the source of truth for actual application content.

The room state should sit on top of the current routing logic rather than replace business logic.

---

# 23. Route Mapping

Map existing routes to room objects.

```text
dashboard
→ home command room

queue
→ triage wall

population
→ filing cabinet

patient
→ active patient hologram

encounter
→ doctor desk + encounter station

flags
→ patient risk visualization / alerts

activity
→ Astra agent activity layer

audit
→ audit archive

operations
→ operations computer

hse
→ forms / printer / operations computer

settings
→ control panel / focus panel

clinic
→ clinic plaque / profile panel
```

---

# 24. Reuse Existing Screens

Do not rewrite mature screens unless needed.

Preferred approach:

```tsx
<CommandRoom>
  ...
  <FocusLayer>
    {route.name === 'patient' && <PatientDetail ... />}
    {route.name === 'encounter' && <NewEncounter ... />}
    {route.name === 'operations' && <OperationsHub ... />}
    {route.name === 'audit' && <Audit ... />}
  </FocusLayer>
</CommandRoom>
```

The 3D environment is a presentation and interaction shell.

The existing backend / APIs remain unchanged unless required for voice orchestration.

---

# 25. Safety / Clinical UX Rules

Must preserve:

- explicit clinician approval of structured notes
- explicit clinician action on risk flags
- explicit clinician resolution of documentation alerts
- uncertain AI output must remain uncertain
- no silent auto-diagnosis
- no silent auto-prescribing
- no invented patient values
- no hidden agent failures
- demo data labeling
- guideline traceability
- clear urgency coloring
- transparent audit trail

Never let visual polish hide clinical uncertainty.

---

# 26. Performance Requirements

Target:

- 60fps on modern desktop where possible
- graceful degradation on weaker devices
- no blocking 3D assets before basic UI becomes usable
- lazy load room assets
- code split large 3D modules
- reuse textures
- compress models
- avoid excessive post-processing
- avoid large video backgrounds

Fallback:

If WebGL is unsupported or performance is poor:

- show the existing 2D MedVoice experience
- do not block access to the product

---

# 27. Accessibility

Support:

- keyboard navigation
- screen-reader access for focus UI
- visible focus states
- reduce-motion preference
- high contrast
- non-color urgency indicators
- text alternatives for room objects
- clear labels for all clinical actions

The 3D room must not become an accessibility barrier.

---

# 28. Build Phases

## Phase 1 — Spatial Shell

Build:

- CommandRoom root
- room scene
- light blue environment
- camera anchors
- Astra orb
- triage wall
- filing cabinet
- desk
- operations monitor
- placeholders for library / calendar / inbox / audit

No new clinical logic.

Goal:
Make the current routes reachable from spatial objects.

---

## Phase 2 — Priority Queue

Connect the existing queue data.

Implement:

- live queue wall
- urgency
- rank
- reason
- smooth reorder animation
- patient selection

This is a high-priority demo component.

---

## Phase 3 — Patient Selection

Connect filing cabinet to current patient search.

Implement:

- patient search
- filters
- selected folder
- patient summary
- send selected patient to patient hologram

---

## Phase 4 — Patient Hologram

Connect current patient record.

Implement:

- patient summary
- vitals
- risk flags
- labs
- meds
- encounters
- care gaps

Do not build full anatomical simulation.

---

## Phase 5 — Encounter Flow

Connect current voice-first encounter.

Implement:

- Astra listening state
- transcript
- agent progress
- SOAP review in Focus Mode
- explicit approval

This is another high-priority demo component.

---

## Phase 6 — Operations and Secondary Objects

Connect:

- Operations monitor
- documentation inbox
- medical library
- care calendar
- audit archive

Reuse existing UI inside focus panels where possible.

---

# 29. Buildathon MVP

If time is limited, prioritize only these six highly polished experiences:

1. Command Room home
2. Triage Wall
3. Patient Filing Cabinet
4. Patient Hologram
5. Voice Encounter
6. Operations Computer

Everything else can be:

- visible in room
- clickable
- routed to the existing screen

The MVP should feel cohesive rather than incomplete.

---

# 30. Demo Flow to Optimize

Optimize the build for this sequence:

## Step 1
Doctor enters Command Room.

Astra:
> “Good morning, Doctor. Three patients require attention.”

## Step 2
Doctor:
> “Show me.”

Camera moves to Triage Wall.

## Step 3
Doctor:
> “Open Maria Joseph.”

Patient folder moves forward.

## Step 4
Camera moves to patient hologram.

Astra summarizes the major change.

## Step 5
Doctor:
> “Why is she high risk?”

Risk card expands.

## Step 6
Doctor:
> “Show the guideline.”

Medical Library reference opens.

## Step 7
Doctor:
> “Start an encounter.”

Camera moves to desk.

## Step 8
Doctor dictates.

Live transcript appears.

## Step 9
Doctor:
> “Finish encounter.”

Agents visibly process.

## Step 10
SOAP review opens in Focus Mode.

Doctor edits if needed.

## Step 11
Doctor clicks:
> Approve and save

## Step 12
Return to room.

Queue visibly updates / reorders.

This full sequence should feel like one continuous environment.

---

# 31. Avoid These Mistakes

Do not:

- rebuild the whole app as custom 3D text
- use WASD
- make the doctor walk around
- turn the room into a game
- hide critical information behind animation
- use excessive neon
- replace existing clinical safeguards
- create fake AI output for production behavior
- auto-approve clinical decisions
- overload the UI with holograms
- turn every existing screen into a floating dashboard
- replicate the existing sidebar inside the room
- create long cinematic transitions
- use animation where a fast UI action is more appropriate

---

# 32. Desired Emotional Effect

The user should feel:

- calm
- in control
- assisted
- informed
- clinically grounded
- futuristic
- impressed

Not:

- overwhelmed
- disoriented
- gamified
- distracted

---

# 33. Final Product Principle

The room should make one core idea obvious:

> **Today’s EHR makes the doctor go looking for information. MedVoice brings the right information to the doctor.**

The spatial metaphors must correspond to real product capabilities:

- filing cabinet = patient records
- triage wall = clinical priority
- hologram = active patient
- desk = encounter
- inbox = unresolved work
- library = evidence
- calendar = follow-up
- computer = clinic operations
- archive = accountability
- Astra = orchestration

That is the design system.

---

# 34. Codex Implementation Instruction

Before modifying code:

1. inspect the current route logic
2. inspect existing API calls
3. identify reusable screens and components
4. preserve existing clinical behavior
5. build the room as an additive shell
6. avoid rewriting backend logic unless necessary
7. keep a fallback path to the current 2D experience

When changing any major component:

- explain what existing behavior is being preserved
- identify which room object owns the interaction
- keep clinician approval boundaries intact
- keep demo / real-data distinction visible
- avoid inventing unsupported clinical functionality

Start by implementing **Phase 1: Spatial Shell** and **Phase 2: Triage Wall**.

Do not attempt the entire Command Room in one pass.


# 35. Image Generation and Visual Asset Production

When this specification is used inside ChatGPT, Codex, or another OpenAI environment that has access to image generation, **proactively use image generation to create the polished visual assets needed for the Command Room**.

Do not leave the experience dependent on generic placeholder art if image generation is available.

Image generation should be treated as part of the implementation workflow.

## Use Image Generation For

Generate original MedVoice-aligned visual assets for:

- Clinical Command Room environment concepts
- room background / architectural references
- wall panel surface treatments
- subtle medical-tech textures
- Astra orb / AI core visual references
- idle Astra states
- listening Astra states
- thinking Astra states
- acting Astra states
- patient hologram visual references
- filing cabinet / digital records wall concepts
- medical library environment
- operations desk environment
- documentation inbox / smart tray
- audit archive / secure records area
- care calendar environmental treatment
- decorative clinic props
- branded wall signage
- ambient medical illustrations
- loading / transition artwork
- empty states
- onboarding visuals
- non-clinical illustrative icons when custom assets improve the experience
- light-blue abstract backgrounds
- subtle glass / glow overlays
- hero visuals for buildathon presentation mode

## Important Asset Rule

Do **not** generate clinical data as static artwork when the data already exists in MedVoice.

For example:

Do not bake these into PNGs:

- patient names
- clinical queue rankings
- lab values
- risk scores
- medication lists
- SOAP note content
- encounter history
- alert counts
- documentation gaps
- audit entries
- guideline thresholds used by the application

Those must remain live UI rendered from the real MedVoice data model.

Image generation should create:

- visual shells
- environment assets
- decorative elements
- spatial metaphors
- textures
- non-data illustrations
- branding assets

The application should render clinical information as real HTML / React UI surfaces over or inside those assets.

---

# 36. Asset Style Guide

All generated assets must visually match the supplied reference images and MedVoice UI.

## Visual Direction

Use:

- white
- bright clinical blue
- pale cyan
- soft sky-blue glow
- subtle navy typography
- clean curved architecture
- smooth white plastic / ceramic surfaces
- brushed silver accents
- translucent glass
- daylight
- large windows
- premium modern clinic atmosphere
- subtle tropical / Caribbean daylight where appropriate
- calm plants / greenery used sparingly
- futuristic but believable healthcare technology

Avoid:

- dark cyberpunk
- purple-dominant neon
- black sci-fi rooms
- spaceship interiors
- holographic clutter
- aggressive red lighting
- dystopian medical imagery
- excessive lens flare
- game UI styling
- unrealistic surgical environments
- uncanny or graphic anatomy

---

# 37. Asset Generation Workflow

For each major room object, follow this workflow:

1. Inspect the relevant reference image.
2. Identify which parts should be:
   - real 3D geometry
   - HTML / React UI
   - generated texture / image
   - simple CSS material
3. Generate visual assets only where they materially improve quality.
4. Save generated assets under a predictable structure.
5. Compress / optimize them for web.
6. Use them as references or textures inside the 3D implementation.
7. Keep the underlying interface functional without the decorative asset.

Suggested asset structure:

```text
client/public/command-room/
  environment/
  astra/
  hologram/
  library/
  filing-cabinet/
  desk/
  operations/
  inbox/
  audit/
  calendar/
  signage/
  textures/
  backgrounds/
```

Use descriptive filenames.

Example:

```text
astra-idle-orb.webp
astra-listening-wave.webp
clinical-room-wall-light.webp
medical-library-panel.webp
patient-hologram-grid.webp
audit-archive-panel.webp
```

Prefer WebP / AVIF where practical.

---

# 38. 3D Versus Generated Image Rule

Do not attempt to create the entire room as one flat image.

The room must remain interactive.

Use real 3D geometry for:

- room floor
- walls
- desks
- monitor frames
- filing cabinet structure
- main hologram pedestal
- Astra pedestal
- major spatial objects
- camera depth / navigation anchors

Generated imagery may be used for:

- environmental backplates
- surface textures
- subtle wall details
- decorative signage
- abstract holographic effects
- medical illustration layers
- room concept references
- placeholder environmental art while 3D models are being built

The final experience should preserve parallax and spatial interaction.

---

# 39. Patient Hologram Asset Rule

The patient hologram should not be a photorealistic human.

Use a:

- stylized neutral human silhouette
- transparent blue/cyan clinical figure
- simplified anatomical glow
- subtle grid / scan lines
- non-gendered base model where possible

The hologram is an information metaphor.

Do not visually imply that MedVoice is performing imaging or anatomical diagnosis unless the underlying application actually supports that.

Risk indicators should be rendered as UI overlays rather than painted permanently into the hologram texture.

---

# 40. Astra Asset Rule

Astra should feel like the intelligence of the room.

Generate several visual references / states.

Required states:

```text
idle
listening
thinking
speaking
acting
error
offline
```

Astra should remain visually consistent across states.

Preferred design:

- luminous blue orb
- white central waveform / MedVoice pulse
- translucent energy shell
- restrained particle field
- subtle circular rings
- premium medical-device aesthetic

Do not make Astra look like:

- a robot head
- a human avatar
- a cartoon mascot
- a generic chatbot bubble

---

# 41. Branded Environmental Assets

Use image generation to help make the room feel specifically like MedVoice rather than a generic futuristic clinic.

Generate tasteful environmental branding such as:

- MedVoice wall mark
- Clinical Command Room signage
- subtle MedVoice pulse motif
- clinic wall plaque
- “People + Insights + Better Care” style environmental text
- book / binder labels
- desk accessories
- branded notebook
- branded mug
- small clinic signage
- patient privacy / audit symbolism

Keep branding restrained.

The environment should feel premium, not like an advertisement.

---

# 42. Image Generation Prompting Guidance

When generating assets, prompts should explicitly mention the established visual language.

Example prompt direction:

> “Premium futuristic clinical command room for MedVoice AI, bright white and light medical blue, soft cyan glass interfaces, large daylight windows, calm modern healthcare architecture, subtle silver trim, clean Caribbean daylight atmosphere, realistic but not sci-fi dystopian, minimal clutter, no dark cyberpunk, no purple neon, high-end healthcare product visualization.”

For isolated assets, specify:

- transparent or simple background where useful
- front / orthographic view if intended as a texture
- no baked text unless the text is decorative only
- no patient data
- no fake clinical metrics

---

# 43. Codex + ChatGPT Visual Collaboration

If Codex is operating inside ChatGPT with image generation available:

**use image generation directly instead of only describing what assets should exist.**

The workflow should be:

1. identify required visual asset
2. generate it
3. inspect it
4. save / reference it
5. integrate it
6. iterate if it does not match the supplied references

Do not stop at:

> “You could generate an image for this.”

Generate the asset when the capability is available.

If the coding environment itself cannot call image generation:

1. create an `ASSET_MANIFEST.md`
2. list every missing asset
3. include an exact image-generation prompt for each
4. mark dimensions / aspect ratio
5. specify transparency requirements
6. continue implementation with temporary CSS / geometry fallbacks

Example:

```text
Asset: Astra Orb — Listening State
File: client/public/command-room/astra/astra-listening.webp
Size: 1024x1024
Background: transparent preferred
Purpose: reference / sprite layer for Astra listening state
Prompt: [complete prompt here]
```

---

# 44. Reference Image Priority

The supplied images should be interpreted as follows:

## Highest priority

Use them for:

- room composition
- light-blue palette
- material feel
- camera framing
- object placement
- overall futurism level
- relationship between 3D environment and floating UI

## Medium priority

Use them for:

- specific panel shapes
- glass treatments
- holographic effects
- object proportions

## Lower priority

Do not copy literally:

- patient names
- fake metrics
- exact text
- exact table contents
- imaginary features
- inconsistent route labels

The repository is the functional source of truth.

The images are the visual source of truth.

---

# 45. Final Visual Acceptance Criteria

The Command Room should pass these tests:

### Home

A screenshot should immediately communicate:

> “This is a clinical command room.”

It should not look like a standard dashboard pasted onto a background.

### Triage

The Priority Queue should feel physically located on the room wall.

### Patients

The filing cabinet / records wall should feel like a spatial metaphor for the existing population screen.

### Patient

The patient hologram should clearly become the center of the room.

### Encounter

The doctor’s desk should feel like the point where conversation becomes documentation.

### Operations

The clinic computer should visibly represent the practical administrative side of MedVoice.

### Astra

The AI should feel like it operates the room rather than existing inside a chat widget.

### Focus Mode

When accuracy matters, the experience should become calmer and more conventional.

### Overall

A buildathon judge should be able to understand the concept from the interface even with the sound muted.

---

# 46. Final Instruction to Codex

Treat this project as a combination of:

- interaction design
- frontend architecture
- real clinical workflow preservation
- 3D spatial UI
- voice interaction
- visual asset generation

Use image generation aggressively for **non-data visual assets** whenever the capability is available.

Use real React UI for **clinical information and actions**.

Use real 3D geometry for **navigation and spatial presence**.

Use the existing MedVoice system for **clinical truth**.

The final result should not simply reproduce the reference images.

It should turn their design language into a working, navigable version of the existing MedVoice AI application.
