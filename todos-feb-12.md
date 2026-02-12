# Deep Writer 2 - TODO List

---

## 1. Tooltip

### Rationale Display
- [x] Suggestion hover 시 tooltip 내 original text 영역에 변경 rationale 함께 표시 (현재는 삭제된 부분만 붉은색 표시 -> rationale 텍스트도 추가)
  - API prompt updated to generate `rationale` field for each alternative (`api/alternatives/route.ts`)
  - Rationale displayed permanently below each suggestion (no hover needed)
  - Scrollable tooltip with always-visible scrollbar + sticky Regenerate button
  - Pre-fetch alternatives on text selection for instant tooltip loading (`CoWriThinkEditor.tsx`, `useAlternatives.ts`)
  - Background pre-fetch sentence/paragraph alternatives on tooltip open — all 3 levels cached before user switches tabs (`AlternativesTooltip.tsx`, `getRangeForLevel`)
  - Zero-frame instant display: `displayAlts` initialized directly from prefetch data (no loading skeleton flash)
  - Inline flash highlight (green fade-out) on applied text via `FlashHighlightPlugin.ts`

### Promptbox Regeneration
- [ ] [Verify] Tooltip promptbox에서 user request가 각 suggestion 재생성에 실제로 영향을 주는지 현재 동작 확인

### Magic Wand Cursor (Nudging UI)
- [x] Tooltip 내 original text/suggestion 위에 마우스 올리면 커서를 magic wand로 변경 (keep/delete 기능 존재를 시각적으로 알려주는 역할)
  - ~~Inline SVG highlighter pen cursor (magic wand -> highlighter pen으로 변경)~~ → 기본 pointer cursor로 복원 in `globals.css`
- [x] 현재는 여러 번 클릭, 드래그하여 변경하도록 하는 UI에서, Magic wand 커서 상태에서 클릭/드래그시  툴팁에 Keep / Positive / Negative / Delete가 뜨면서 사용자의 의도를 전달할 수 있도록 하는 UI로 변경
  - Removed old 3-state painting/drag mode entirely from `AnnotatableText.tsx`
  - New interaction: drag to select word range -> `WordAnnotationPopup` appears with 4 buttons (Del / - / + / Keep)
  - Single word click also supported; dragging extends selection across multiple words


### Label System (Keep/Positive/Negative/Delete)
- [x] 4단계 유지: Keep / Positive / Negative / Delete
  - `WordAnnotation` type expanded to `'positive' | 'negative' | 'keep' | 'delete'` in `AnnotatableText.tsx`
  - New CSS classes: `.word-annotation-keep` (blue), `.word-annotation-delete` (amber + strikethrough), with dark mode variants
  - Inline badge labels after annotated words (`.word-badge`): `del`, `-`, `+`, `keep` — no need to memorize colors
  - Popup button order: Del -> - -> + -> Keep (negative to positive, left to right)
  - Serialization updated in `AlternativesTooltip.tsx`: keep/positive -> PRESERVE/LIKE, negative -> AVOID/DISLIKE, delete -> DELETE
  - `<DELETE>` tag added to API prompt in `api/alternatives/route.ts`
- [x] Tooltip이 자동으로 사라지지 않도록 변경
  - Already implemented (no auto-dismiss timer existed; only Escape or click-outside dismisses)
- [x] 한 번 더 클릭 시 keep/delete로 토글 전환되는 UX
  - `secondClickConvert()` in `AnnotatableText.tsx`: positive -> keep, negative -> delete, keep/delete -> remove

### Apply Button
- [x] Apply 버튼 높이를 각 suggestion 영역 전체에 맞추어 확대
  - `AlternativesTooltip.tsx`: flex container `alignItems: 'flex-start'` → `'stretch'`로 변경
  - `globals.css`: `.alternatives-tooltip-apply-btn`에 `display: flex; align-items: center` 추가, padding 조정

### Selective Regeneration
- [ ] 특정 suggestion에 mark(positive/negative) 후 "regenerate" 클릭 시, mark된 suggestion만 재생성하고 나머지는 유지

---

## 2. Tooltip -> Chat Input 연동

- [ ] Tooltip에서 "alternative" 옆에 negative/positive/keep/delete 버튼 추가
- [ ] 해당 버튼 클릭 시 오른쪽 chat input 박스 위에 선택한 텍스트가 label로 추가 (Cursor 스타일)
- [ ] 유저가 chat에서 메시지 전송 시 본문의 하이라이트(붉은색/푸른색) + chat input 위 label 모두 초기화

---

## 3. Chat Panel (Right Side)

### Markdown Rendering
- [x] Chat text output 패널에 마크다운 렌더링 적용 (already implemented via `ReactMarkdown` + `rehype-highlight` in ChatPanel)

### Conversational UX
- [x] Chat 시스템 프롬프트를 ChatGPT/Gemini처럼 대화형으로 개선 (rationale/opinion 설명 포함)
- [x] 글쓰기 컨텍스트라는 것을 프롬프트 내에 포함하되, 위의 사항 고려하여 일반적인 AI 대화 경험과 동일하게 유지

<details>
<summary>Before / After</summary>

**System Prompt (`src/app/api/chat/route.ts`)**

- Before: Rigid intent-classifier prompt ("CoWriThink AI, a sophisticated co-writing partner") with strict classification rules, academic tone, unused `reasoning` JSON field, `max_tokens: 512`
- After: General conversational AI assistant that naturally has writing context. Encourages genuine opinions with reasoning ("I think...", "In my opinion..."). Removed wasted `reasoning` field. `max_tokens: 1024`

**UI Text (`src/components/chat/ChatPanel.tsx`)**

| Element | Before | After |
|---------|--------|-------|
| Empty state heading | "Ask about your writing" | "Start a conversation" |
| Empty state subtitle | "Chat about ideas, ask for feedback, or request edits to your document." | "Ask questions, brainstorm ideas, get feedback on your writing, or request edits." |
| Input placeholder | "Ask about your writing or request an edit..." | "Type a message..." |

</details>

---

## 4. Context Labels (Pasted Text)

- [ ] 긴 텍스트 붙여넣기 시 "[Pasted text #1 +N lines]"로 자동 축약, 클릭 시 확장
- [ ] 붙여넣은 텍스트에 시각적 label/highlight 효과 적용 (Slack 스타일: 텍스트 수정/삭제 시 효과 제거)

---

## 5. Basic UI Changes

- [x] 초기 진입 시 "task want to write" 입력 + 시작 모드 선택 UI 제거
  - Removed `GoalModal` and `StartModeSelector` from `page.tsx`; app skips directly to editor on mount
- [x] New Session 버튼 클릭 시 확인 다이얼로그 추가 ("정말 지우시겠습니까?")
  - Confirmation dialog added in `page.tsx` with `showNewSessionConfirm` state
- [x] 제목 입력 UI 제거
  - `GoalDisplay` component and `goal`/`onGoalEdit` props removed from `AppHeader.tsx`

---

## 6. Evaluation Logic

- [ ] [Review] 현재 round 평가 방법 체크 - missing points 확인
- [ ] [Review] 3 dimension update 로직 강건성 검토

---

## 7. AI Dependency Highlighting

- [x] 상단 toolbar에 "AI 의존 하이라이팅" 버튼 추가 (눈알 버튼 옆에 배치)
- [x] 버튼 클릭 시 유저가 AI 의존도가 높다고 생각하는 부분을 하이라이팅 가능
- [x] ~~여러 번 하이라이팅하면 색상 강도 증가~~ → 3-level 선택 방식으로 변경 (Slightly AI / Moderately AI / Mostly AI)
  - `UserAnnotationPlugin.ts`: intensity 필드를 level (1|2|3)로 교체, 페인팅 시 선택된 레벨로 덮어쓰기 (기존 increment 방식 제거)
  - `useUserAnnotationStore.ts`: `selectedLevel` 상태 + `setSelectedLevel()` 액션 추가, `AnnotationLevel` 타입 및 `ANNOTATION_LEVEL_LABELS` 내보내기
  - `AppHeader.tsx`: highlight/eraser 토글 → 3개 레벨 버튼 (색상 swatch 포함) + eraser 버튼으로 교체
  - `CoWriThinkEditor.tsx`: `annotationLevel` store→plugin 동기화 useEffect 추가
  - `globals.css`: ~~5단계 → 3단계 CSS (15%/35%/55% opacity)~~ → diagonal stripe 패턴으로 변경 (repeating-linear-gradient, 레벨별 밀도/투명도 차등)
- [x] 지우개 도구로 기존 하이라이팅 제거 가능
- [x] ~~하이라이팅 완료 후 "Actual AI" / "Your View" 토글로 실제 AI 의존도와 비교~~ → 토글 제거, 두 레이어 동시 표시로 변경
  - ~~`useInspectStore.ts`: `comparisonView` 상태 제거~~ — `comparisonView` 의존성 전면 제거
  - `CoWriThinkEditor.tsx`: annotation stripes + contribution overlay 동시 표시 (highlight/inspect 모드에서 모두), comparisonView 토글 로직 제거
  - `AppHeader.tsx`: "Actual AI" / "Your View" 토글 버튼 제거
  - `InspectPanel.tsx`: comparisonView 조건 분기 제거, PerceptionComparison 항상 DocumentLevelView 하단에 표시
  - `useUserAnnotationStore.ts`: `annotationRanges` 배열 추가 (annotation 위치/레벨 전체 추적)
  - `useSessionStore.ts`: session export에 `userAnnotations` 포함
  - `session.ts`: `Session` 타입에 `userAnnotations` 필드 추가

---

## 8. Interaction Logging

- [ ] 모든 유저 인터렉션 로그 추적 및 저장 (클릭, 타이핑, tooltip 상호작용, keep/delete, 재생성, 채팅 등 전체)

---

## 9. Chat Smart-Edit (빈 문서에서 글 생성)

- [x] 빈 문서에서 채팅으로 글 생성 시 Original/Modified 패널이 모두 비어보이는 버그 수정
  - 근본 원인: `useSessionStore`에서 초기 문서를 `content: []`로 생성 → ProseMirror `doc.content.size=0` → diff position(1)이 문서 범위 초과 → `computeDiffViews`에서 diff가 skip됨
  - Fix 1: `useSessionStore.ts` — 초기 documentState에 빈 paragraph 포함 (`content: [{ type: 'paragraph' }]`)
  - Fix 2: `api/generate/route.ts` — smart-edit 모드에서 빈 goal 허용 (userRequest가 의도를 담으므로)
  - Fix 3: `api/generate/route.ts` — smart-edit 모드에서 maxTokens를 문서+요청 길이 기반 최소 2048로 계산 (기존: gap 기반 1024 고정)

- [x] Chat smart-edit 시 사소한 변경만 발생하고 실질적 편집이 되지 않는 문제 수정
  - 근본 원인 1: Chat API가 "edit" OR "chat" 택일 방식 → edit일 때 간단한 확인 메시지만 반환
  - 근본 원인 2: Smart-edit 시스템 프롬프트가 "COMPLETE" 강조 → AI가 원문 보존 편향
  - 근본 원인 3: 잘림 방지 가드(30% 미만 거부)가 축약 요청의 정상적 결과를 차단
  - Fix 1: `api/chat/route.ts` — 파이프라인을 "항상 chat 응답 + 선택적 edit" 방식으로 변경 (`{ reply, shouldEdit }`)
  - Fix 2: `api/generate/route.ts` — Smart-edit 프롬프트 강화 (편집 유형별 구체적 가이드 추가)
  - Fix 3: `api/generate/route.ts` — 축약 요청 시 잘림 가드 완화 (30% → 5%)
  - Fix 4: `useChat.ts`, `useChatStore.ts`, `ChatPanel.tsx` — 새 API 포맷 소비하도록 업데이트

---

## 10. Inspect Mode - Category Hover Visualization

- [ ] InspectPanel의 각 dimension chip (Wording/Concept/Evaluation)에 hover 시:
  - [ ] 에디터 텍스트가 해당 dimension 점수 기준으로 re-coloring (composite -> single dimension)
  - [ ] InspectPanel 내 해당 dimension의 상세 breakdown 정보 표시
- [ ] Document-level view와 Segment-level view 모두에서 작동
- [ ] 각 dimension별 고유 색상 계열 사용 (예: Wording=blue계열, Concept=green계열, Evaluation=orange계열)
- [ ] hover 해제 시 기존 composite score 기반 coloring으로 복원
