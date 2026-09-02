// 외부 AI와 상의하기 — 질문을 들고 나갔다가 답을 들고 돌아오는 왕복.
//
// 이 앱의 질문은 좋지만 답하기 어렵다. 예산·범위·기술 선택은 혼자 정하기보다
// 쓰던 AI와 이야기하며 정하는 편이 낫다. 그래서 질문을 통째로 들고 나갈 수 있게 한다.
//
//   [복사] → 다른 AI에 붙여넣고 상의 → 답변 블록을 받아 → [붙여넣기] → 카드가 채워진다
//
// 나갈 때는 **맥락까지** 실어야 한다. 질문만 던지면 상대 AI가 이 프로젝트를 모른 채
// 일반론으로 답한다. 그래서 확정된 내용을 요약해 함께 보낸다.
//
// 돌아온 답은 **신뢰하지 않는다.** 사람이 손으로 고쳤을 수도, 다른 AI가 형식을 어겼을 수도
// 있다. 파서는 관대하게 읽되 모르는 것은 조용히 버리고, 무엇을 읽었는지 돌려준다.

import { SECTION_DEFS, SECTION_IDS, type PRDState } from '../types/prd.js';
import type { AnswerMap, EngineQuestion } from './question.js';

/** 상의 브리핑에 실을 확정 내용의 항목당 최대 길이. 전문을 보내면 붙여넣기가 감당 못 한다. */
export const CONTEXT_CHARS = 400;

function clip(text: string, max = CONTEXT_CHARS): string {
  const t = text.trim().replace(/\n{3,}/g, '\n\n');
  return t.length <= max ? t : `${t.slice(0, max).trimEnd()}…`;
}

/**
 * 다른 AI에게 붙여넣을 브리핑을 만든다.
 *
 * 답변 형식을 **예시로** 보여준다. 규칙만 설명하면 형식이 어긋나 돌아온다.
 */
export function buildConsultPrompt(
  state: PRDState,
  questions: readonly EngineQuestion[],
): string {
  const name = state.projectName || '(제목 미정)';
  const out: string[] = [
    '# 제품 기획 상의 요청',
    '',
    `저는 지금 **${name}** 의 제품 요구사항 문서(PRD)를 만들고 있습니다.`,
    '기획 도구가 아래 질문을 던졌는데, 답을 함께 정리해 주세요.',
    '',
    '**부탁:**',
    '- 각 질문마다 무엇을 고를지와 그 이유를 짚어 주세요.',
    '- 제 상황과 안 맞는 보기가 있으면 그렇다고 말해 주세요. 억지로 고르지 않아도 됩니다.',
    '- 확실하지 않은 서비스명·가격·성능 수치는 `[미검증]`이라고 표시해 주세요.',
    '- 마지막에 **아래 형식 그대로** 답변 블록을 만들어 주세요. 제가 도구에 그대로 붙여넣습니다.',
    '',
    '---',
    '',
    '## 지금까지 정해진 것',
    '',
  ];

  const decided = SECTION_IDS
    .map((id) => ({ id, s: state.sections[id] }))
    .filter(({ s }) => s.content.trim() !== '');

  if (decided.length === 0) {
    out.push('아직 아무것도 정해지지 않았습니다. 이번이 첫 질문입니다.', '');
  } else {
    for (const { id, s } of decided) {
      out.push(`### ${SECTION_DEFS[id].label}`, '', clip(s.content), '');
    }
  }

  const frs = state.requirements.filter((r) => r.section === 'FR');
  const nfrs = state.requirements.filter((r) => r.section === 'NFR');
  if (frs.length + nfrs.length > 0) {
    out.push('### 등록된 요구사항', '');
    out.push(...frs.map((r) => `- ${r.id} ${r.title}`));
    out.push(...nfrs.map((r) => `- ${r.id} ${r.title}`));
    out.push('');
  }

  if (state.unverifiedTerms.length > 0) {
    out.push('### 아직 확인 못 한 것 [미검증]', '');
    out.push(...state.unverifiedTerms.map((t) => `- ${t}`), '');
  }

  out.push('---', '', '## 질문', '');

  for (const q of questions) {
    out.push(`### ${q.id}. ${q.text}`, '');
    if (q.options.length === 0) {
      out.push('*(보기 없음 — 직접 답해야 하는 질문입니다)*', '');
    } else {
      for (const o of q.options) {
        out.push(`- **${o.key})** ${o.label}${o.recommended ? ' — *도구 추천*' : ''}`);
        if (o.detail) out.push(`  - ${o.detail}`);
      }
      out.push('');
    }
  }

  out.push(
    '---',
    '',
    '## 답변 형식 (이대로 만들어 주세요)',
    '',
    '```',
    '[답변]',
    ...questions.flatMap((q) => (
      q.options.length > 0
        ? [`${q.id}: ${q.options[0]!.key}`, `${q.id} 의견: (고른 이유나 조건을 한두 줄)`]
        : [`${q.id} 의견: (답을 여기에)`]
    )),
    '```',
    '',
    '보기가 다 맞지 않으면 알파벳을 비우고 의견만 적어 주세요.',
  );

  return out.join('\n');
}

// --- 돌아온 답 읽기 ---------------------------------------------------------

export interface ParsedAnswer {
  questionId: string;
  choice: string | null;
  note: string;
}

export interface ParseResult {
  answers: ParsedAnswer[];
  /** 질문 목록에 없는 번호 등, 읽었지만 버린 것. UI가 사용자에게 알린다. */
  ignored: string[];
}

/** `Q1`, `q1`, `1`, `질문 1` 모두 받는다. 형식을 외우게 하지 않는다. */
const HEAD = /^\s*[-*>#\s]*(?:q|Q|질문\s*)?(\d{1,2})\s*(?:번)?\s*(?:의견|답변|답|note)?\s*[.):：:\-—]\s*(.*)$/;

/** 줄 앞머리의 목록 기호·인용 부호를 걷어낸다. */
const stripLead = (s: string) => s.replace(/^\s*[->*•·]+\s*/, '').trim();

/** `B`, `B)`, `(B)`, `선택: B`, `B) 정적 호스팅` 에서 알파벳 하나를 뽑는다. */
function readChoice(rest: string, valid: readonly string[]): { choice: string | null; left: string } {
  const t = stripLead(rest).replace(/^(?:선택|choice)\s*[:：]\s*/i, '').trim();
  const m = /^\(?\s*([A-Za-z])\s*\)?\s*(?:[.)\-—:]\s*)?(.*)$/.exec(t);
  if (m) {
    const key = m[1]!.toUpperCase();
    if (valid.includes(key)) return { choice: key, left: m[2]!.trim() };
  }
  return { choice: null, left: t };
}

/**
 * 다른 AI가 돌려준 텍스트에서 답변을 읽는다.
 *
 * 형식이 어긋나도 최대한 건진다. `[답변]` 표지가 없어도, 앞뒤에 잡담이 붙어 있어도
 * `Q1:` 같은 줄만 있으면 읽는다. **모르는 것은 조용히 버린다** — 앱이 죽으면 안 된다.
 */
export function parseConsultReply(
  text: string,
  questions: readonly EngineQuestion[],
): ParseResult {
  const byNum = new Map<string, EngineQuestion>();
  for (const q of questions) {
    const n = /(\d{1,2})/.exec(q.id)?.[1];
    if (n) byNum.set(String(Number(n)), q);
  }

  const found = new Map<string, { choice: string | null; notes: string[] }>();
  const ignored = new Set<string>();
  let current: string | null = null;

  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const head = HEAD.exec(line);

    if (head) {
      const num = String(Number(head[1]!));
      const q = byNum.get(num);
      if (!q) {
        ignored.add(`Q${num}`);
        current = null;
        continue;
      }
      current = q.id;
      const entry = found.get(q.id) ?? { choice: null, notes: [] };

      // "Q1 의견:" 처럼 의견임이 명시된 줄은 알파벳을 찾지 않는다.
      const isNote = /(?:의견|답변|답|note)\s*[.):：:\-—]/.test(line);
      const rest = head[2] ?? '';
      if (isNote) {
        if (rest.trim()) entry.notes.push(stripLead(rest));
      } else {
        const { choice, left } = readChoice(rest, q.options.map((o) => o.key));
        if (choice) entry.choice = choice;
        if (left) entry.notes.push(left);
      }
      found.set(q.id, entry);
      continue;
    }

    // 머리글 없는 줄은 직전 질문의 의견으로 이어붙인다.
    if (current) {
      const body = stripLead(line);
      // 코드 울타리와 표지는 본문이 아니다
      if (body === '' || /^(```|\[답변\]|---+)$/.test(body)) {
        if (body === '') current = null;   // 빈 줄에서 블록이 끊긴다
        continue;
      }
      found.get(current)?.notes.push(body);
    }
  }

  const answers: ParsedAnswer[] = [];
  for (const q of questions) {
    const e = found.get(q.id);
    if (!e) continue;
    const note = e.notes.join(' ').replace(/\s+/g, ' ').trim();
    // 고른 것도 적은 것도 없으면 답이 아니다. 빈 답으로 카드를 덮지 않는다.
    if (e.choice === null && note === '') continue;
    answers.push({ questionId: q.id, choice: e.choice, note });
  }

  return { answers, ignored: [...ignored] };
}

/** 읽은 답을 기존 답변 위에 얹는다. 파싱이 못 읽은 질문의 기존 입력은 지우지 않는다. */
export function mergeAnswers(current: AnswerMap, parsed: readonly ParsedAnswer[]): AnswerMap {
  const next: AnswerMap = { ...current };
  for (const p of parsed) {
    next[p.questionId] = { choice: p.choice, note: p.note };
  }
  return next;
}
