/**
 * Content-first classifier for inbound registry correspondence (Bree, Phase 4).
 * A single Claude API call with a forced tool = reliable structured output.
 *
 * Sender address is a corroborating signal only — forwarded mail (a rep
 * forwarding a UKIPO report from their own law-firm domain) must classify
 * identically to a direct email. The dangerous failure is a wrong HIGH-
 * confidence result, so the prompt tunes conservative: when unsure, drop to
 * medium/low, never invent a reference number, never force a HIGH type.
 */
import Anthropic from '@anthropic-ai/sdk';
import { COMMUNICATION_TYPES, REGISTRIES, CONFIDENCE_LEVELS, type Classification, type EmailInput } from './email-types';
import { extractRefStrings } from './email-refs';

export const EMAIL_CLASSIFIER_MODEL = process.env.EMAIL_CLASSIFIER_MODEL ?? 'claude-sonnet-4-6';

const SYSTEM = `You classify inbound trademark REGISTRY correspondence for a portfolio tool. v1 covers UKIPO (UK) and EUIPO (EU); you may also see WIPO. Notifications are surfaced to an IP lawyer via Slack, and some HIGH-confidence types trigger automatic portfolio changes — so a wrong HIGH-confidence answer is the worst outcome. When in doubt, lower the confidence.

CLASSIFY FROM CONTENT, not the sender. Forwarded mail is normal: a representative forwarding a UKIPO examination report arrives from a law-firm domain, not @ipo.gov.uk. Direct, customer-forwarded, and representative-forwarded email must classify identically. Use signals in this priority: (1) body + subject wording and document structure; (2) reference numbers; (3) text extracted from PDF attachments — "please see attached" with the substance in the PDF is normal; (4) forwarding chains (FW:, quoted headers); (5) sender address, corroborating only.

communicationType definitions:
- registration_certificate: the registry confirms the mark is now REGISTERED (certificate of registration). Auto-actable.
- renewal_reminder: the registry warns a renewal is DUE / upcoming. Auto-actable (reconcile against our own deadline).
- renewal_confirmation: the registry CONFIRMS a renewal has been PROCESSED/recorded (mark renewed). Distinct from a reminder. Auto-actable (clears the deadline).
- examination_report: examination report / office action / objection raising grounds. Alert only.
- opposition_notice: the registry's INITIAL notice that a third party has filed an opposition AGAINST the recipient's mark (e.g. a TM7 has been filed; a TM8 counter-statement / TM9C cooling-off deadline is set). Only the opening notice. Alert only. This is against OUR mark — contrast watch_notice below.
- opposition_procedural: procedural, hearing, or decision correspondence WITHIN ongoing opposition or cancellation (tribunal) proceedings — hearing notices, evidence-round deadlines, deficiency notices, costs awards, hearing-officer decisions, consolidation letters. Anything after the initial opposition notice. Alert only.
- watch_notice: a watch alert that SOMEONE ELSE's newly published or filed mark may conflict with the recipient's earlier right, inviting them to consider opposing it. Issued EITHER by the registry (a publication-for-opposition notice) OR by a commercial trademark watch service. The recipient is the potential OPPONENT, not the party being opposed. Alert only.
- cancellation_notice: a notice that the mark itself is being cancelled / surrendered / revoked / removed (dead-mark detection). Procedural letters inside a cancellation action are opposition_procedural, not this. Alert only.
- euipo_login_notification: EUIPO "you have a new communication — log in to your User Area" with no substantive content in the email itself. Alert only.
- ambiguous: not clearly registry correspondence (e.g. a client asking a question). Low confidence, no invented data.
- other: registry correspondence that fits none of the above.

confidence:
- high: registry, type, and at least one reference number are clear AND the type is one of registration_certificate / renewal_reminder / renewal_confirmation. Only HIGH triggers automatic action — be strict.
- medium: type is fairly clear but not auto-actable, or a key detail (registry/reference) is uncertain.
- low: genuinely ambiguous, or not registry correspondence.

For watch_notice ONLY, also fill the watchNotice object. A registry notification of this kind describes TWO marks: the recipient's own earlier right, and the later third-party application that has been published. Keep them apart. thirdPartyMarkText / thirdPartyApplicationNumber / thirdPartyClasses / filingDate / publicationDate describe the THIRD PARTY's application. citedMarkReferences lists the RECIPIENT's own earlier mark numbers that the notice quotes. Set oppositionDeadline only when the notice states the date the opposition period ends; do not compute it from a publication date. Use null for anything not stated. Leave watchNotice out entirely for every other communicationType.

Return every reference number you can find, verbatim as written. List any deadline dates the text mentions with a short description. Write a one-sentence summary. Never fabricate a reference number or deadline that is not present.`;

const TOOL = {
  name: 'classification',
  description: 'Structured classification of the email.',
  input_schema: {
    type: 'object' as const,
    properties: {
      registry: { type: 'string', enum: [...REGISTRIES] },
      communicationType: { type: 'string', enum: [...COMMUNICATION_TYPES] },
      referenceNumbers: { type: 'array', items: { type: 'string' } },
      deadlinesMentioned: {
        type: 'array',
        items: {
          type: 'object',
          properties: { date: { type: 'string' }, description: { type: 'string' } },
          required: ['date', 'description'],
        },
      },
      confidence: { type: 'string', enum: [...CONFIDENCE_LEVELS] },
      summary: { type: 'string' },
      watchNotice: {
        type: 'object',
        description:
          'Populate ONLY when communicationType is watch_notice. Use null for any field the notice does not state.',
        properties: {
          thirdPartyMarkText: { type: ['string', 'null'] },
          thirdPartyApplicationNumber: { type: ['string', 'null'] },
          thirdPartyClasses: { type: 'array', items: { type: 'integer' } },
          filingDate: { type: ['string', 'null'], description: 'ISO date, the third party application filing date' },
          publicationDate: { type: ['string', 'null'], description: 'ISO date' },
          oppositionDeadline: { type: ['string', 'null'], description: 'ISO date the opposition period ends, only if stated' },
          citedMarkReferences: {
            type: 'array',
            items: { type: 'string' },
            description: "The RECIPIENT's own earlier mark numbers that the notice cites, verbatim.",
          },
        },
        required: ['thirdPartyMarkText', 'thirdPartyApplicationNumber', 'thirdPartyClasses', 'citedMarkReferences'],
      },
    },
    required: ['registry', 'communicationType', 'referenceNumbers', 'deadlinesMentioned', 'confidence', 'summary'],
  },
};

function buildUserContent(input: EmailInput): string {
  const parts = [`Subject: ${input.subject || '(none)'}`];
  if (input.fromAddress) parts.push(`From: ${input.fromAddress}  (sender is a corroborating signal only)`);
  parts.push(`\nBody:\n${input.bodyText || '(empty)'}`);
  (input.attachmentTexts ?? []).filter((t) => t.trim()).forEach((t, i) => parts.push(`\n--- Attachment ${i + 1} (extracted text) ---\n${t}`));
  return parts.join('\n');
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set — add it to .env to run the classifier (local only).');
  }
  return (client ??= new Anthropic());
}

export async function classifyEmail(input: EmailInput): Promise<Classification> {
  const res = await anthropic().messages.create({
    model: EMAIL_CLASSIFIER_MODEL,
    max_tokens: 1024,
    temperature: 0, // deterministic — reproducible classifications + stable harness
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
    messages: [{ role: 'user', content: buildUserContent(input) }],
  });

  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  if (!block) throw new Error('Classifier did not return a structured result');
  const c = block.input as Classification;

  // Union the model's refs with the deterministic extractor — the regex is the
  // ground truth for matching and catches refs the model may paraphrase/miss.
  const regexRefs = extractRefStrings(input.subject, input.bodyText, ...(input.attachmentTexts ?? []));
  c.referenceNumbers = Array.from(new Set([...(c.referenceNumbers ?? []), ...regexRefs]));
  return c;
}
