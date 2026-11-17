// journeys.mjs: a RiseGuide-style learning path inside the feed.
//
// One lesson unlocks per day, in order, and lands in the feed as a "lesson"
// card: one idea from a named source, a cheat sheet, a 60-second exercise
// (with the practice recorder), and a recall question. Completing it moves
// the path on; tomorrow the next one unlocks. No model call: the curriculum
// below is fixed and every lesson points at a real book or talk, so nothing
// in a lesson is invented. Routines can still add extra cards around it.
//
// State: state/journey.json  { speaking: { started, done: { <lesson id>: iso }, posted: { <lesson id>: post id } } }

import { readJSON, writeJSON } from './store.mjs';
import { handleFeedCall } from './feed.mjs';

const STATE = 'state/journey.json';
const TZ = process.env.TODOUZ_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
const localDay = (ms = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

const TED = (slug) => `https://www.ted.com/talks/${slug}`;

export const JOURNEYS = {
  speaking: {
    title: 'Speak with confidence',
    blurb: 'Fourteen days from your voice to conversations, stories and pitches. About 10 minutes a day.',
    lessons: [
      {
        id: 'voice-five-foundations', title: 'Your voice has five dials',
        source: { title: 'The 5 Vocal Foundations of Great Communication', author: 'Vinh Giang', url: 'https://www.youtube.com/watch?v=CuaY4qe4V34' },
        idea: 'Vinh Giang teaches that how you sound comes down to five things you can control on purpose: rate (speed), volume, pitch, tonality and pausing. Most people leave all five on one setting, which is what makes them sound flat. Treat them as dials, not personality.',
        cheat: ['Rate: slow down for what matters, speed up for the setup', 'Volume: louder for energy, softer to pull people in', 'Pitch: move it, a flat line sounds bored', 'Tonality: match the emotion of the words', 'Pausing: silence before and after the key line'],
        exercise: 'Read this sentence three times, each time turning a different dial: "This is the one thing I want you to remember today." Record the third take.',
        question: 'Name the five vocal foundations.', answer: 'Rate, volume, pitch, tonality and pausing.',
      },
      {
        id: 'voice-pause', title: 'The pause is the loudest thing you can say',
        source: { title: 'The 5 Vocal Foundations of Great Communication', author: 'Vinh Giang', url: 'https://www.youtube.com/watch?v=CuaY4qe4V34' },
        idea: 'A pause before an important word makes people lean in; a pause after it gives them time to take it in. Filler words ("um", "like") usually appear exactly where a pause should be. Swap the filler for silence and you sound more confident without changing a word.',
        cheat: ['Pause before the key word, not after every sentence', 'When you feel an "um" coming, close your mouth instead', 'Count one beat in your head; it feels longer to you than to them'],
        exercise: 'Explain what you are studying this semester in 60 seconds. Every time you would say "um", pause instead. Record it and check your filler count.',
        question: 'Where do filler words tend to appear?', answer: 'Exactly where a pause should be. Replace the filler with silence.',
      },
      {
        id: 'treasure-toolbox', title: 'Speak so people want to listen',
        source: { title: 'How to speak so that people want to listen (TED)', author: 'Julian Treasure', url: TED('julian_treasure_how_to_speak_so_that_people_want_to_listen') },
        idea: 'Julian Treasure lists seven habits that make people stop listening: gossip, judging, negativity, complaining, excuses, exaggeration and dogmatism. He offers HAIL instead as the foundation for being heard: Honesty, Authenticity, Integrity and Love.',
        cheat: ['Avoid: gossip, judging, negativity, complaining, excuses, exaggeration, dogmatism', 'Stand on HAIL: Honesty, Authenticity, Integrity, Love', 'His vocal toolbox adds register, timbre, prosody, pace, pitch and volume'],
        exercise: 'Tell a 60-second story about a frustrating group project without complaining or blaming anyone. Focus on what you learned.',
        question: 'What does HAIL stand for?', answer: 'Honesty, Authenticity, Integrity, Love.',
      },
      {
        id: 'sinek-why', title: 'Start with why',
        source: { title: 'How great leaders inspire action (TED)', author: 'Simon Sinek', url: TED('simon_sinek_how_great_leaders_inspire_action') },
        idea: 'Simon Sinek\'s Golden Circle: most people explain what they do, then how, and rarely why. People who inspire go the other way: why they do it, then how, then what. "People don\'t buy what you do, they buy why you do it."',
        cheat: ['Why: the belief or purpose', 'How: what makes your approach different', 'What: the product, project or result', 'Open with why when you want buy-in'],
        exercise: 'Pitch the project you care most about in 60 seconds, starting with why it exists before you say what it is.',
        question: 'In what order does the Golden Circle go when you want to inspire?', answer: 'Why, then how, then what.',
      },
      {
        id: 'ted-throughline', title: 'One talk, one idea',
        source: { title: 'TED Talks: The Official TED Guide to Public Speaking', author: 'Chris Anderson', book: true },
        idea: 'Chris Anderson argues that every good talk has a throughline: one connecting idea that every part of the talk builds towards. If you can\'t say it in about 15 words, the talk isn\'t ready. Cutting good material that doesn\'t serve the throughline is the job, not a loss.',
        cheat: ['Write your throughline in 15 words or fewer', 'Every story or slide must serve it', 'Cut anything that doesn\'t, however good'],
        exercise: 'Pick your next presentation or meeting. Say its throughline out loud in one sentence, then give the 60-second version.',
        question: 'What is a throughline?', answer: 'The one connecting idea every part of the talk builds towards, sayable in about 15 words.',
      },
      {
        id: 'gallo-three', title: 'The rule of three',
        source: { title: 'Talk Like TED', author: 'Carmine Gallo', book: true },
        idea: 'Carmine Gallo shows that audiences remember three things far better than five or ten. Great speakers group their message into three key points, and keep talks short: TED caps them at 18 minutes because attention and memory fall off after that.',
        cheat: ['Group your message into three points', 'Signpost them: "first, second, third"', 'Shorter beats longer: make it fit the time'],
        exercise: 'Answer "Why should someone hire you?" with exactly three reasons, signposted, in 60 seconds.',
        question: 'How many key points does Gallo recommend?', answer: 'Three.',
      },
      {
        id: 'sticky-success', title: 'Make ideas stick',
        source: { title: 'Made to Stick', author: 'Chip Heath and Dan Heath', book: true },
        idea: 'The Heath brothers found that ideas that stick share six traits, SUCCESs: Simple, Unexpected, Concrete, Credible, Emotional, Stories. You rarely need all six; adding one or two to a dry explanation changes how much people remember.',
        cheat: ['Simple: find the core', 'Unexpected: break a pattern', 'Concrete: something you can picture', 'Credible: a detail people can check', 'Emotional: make them care', 'Stories: show it happening'],
        exercise: 'Explain one concept from a subject you are studying in 60 seconds using a concrete example and one unexpected fact.',
        question: 'What does SUCCESs stand for?', answer: 'Simple, Unexpected, Concrete, Credible, Emotional, Stories.',
      },
      {
        id: 'storyworthy-homework', title: 'Collect stories every day',
        source: { title: 'Storyworthy', author: 'Matthew Dicks', book: true },
        idea: 'Matthew Dicks, a many-time Moth StorySLAM champion, uses "Homework for Life": each evening, write down the most story-worthy moment of the day in a sentence or two. Over months it becomes a bank of true stories for conversations and talks. Good stories turn on a moment of change.',
        cheat: ['Every night: one line about the day\'s most story-worthy moment', 'Look for a moment where something changed', 'True and small beats big and invented'],
        exercise: 'Tell yesterday\'s most story-worthy moment in 60 seconds. End on what changed.',
        question: 'What is Homework for Life?', answer: 'Writing down the most story-worthy moment of each day, every day.',
      },
      {
        id: 'headlee-conversation', title: 'Ten rules for a better conversation',
        source: { title: '10 ways to have a better conversation (TED)', author: 'Celeste Headlee', url: TED('celeste_headlee_10_ways_to_have_a_better_conversation') },
        idea: 'Radio host Celeste Headlee\'s rules include: don\'t multitask, don\'t pontificate, use open-ended questions, go with the flow, say when you don\'t know, don\'t equate your experience with theirs, don\'t repeat yourself, stay out of the weeds, listen, and be brief. Her point: be interested in the other person.',
        cheat: ['Ask open questions: who, what, when, where, why, how', 'Let your next question come from their answer', 'Don\'t turn their story into yours', 'Listen to understand, not to reply'],
        exercise: 'Write three open-ended questions for the next person you will meet this week, then say them out loud naturally.',
        question: 'Name three of Headlee\'s rules.', answer: 'Any three of: no multitasking, don\'t pontificate, open questions, go with the flow, say you don\'t know, don\'t equate experiences, don\'t repeat, skip the details, listen, be brief.',
      },
      {
        id: 'carnegie-interest', title: 'Be interested, not interesting',
        source: { title: 'How to Win Friends and Influence People', author: 'Dale Carnegie', book: true },
        idea: 'Carnegie\'s principles include: become genuinely interested in other people, remember that a person\'s name is to that person the sweetest sound in any language, be a good listener, and talk in terms of the other person\'s interests. Conversations feel natural when the other person feels heard.',
        cheat: ['Use their name, and remember it', 'Ask about what they care about', 'Listen more than you talk', 'Make them feel important, and mean it'],
        exercise: 'Practise introducing yourself and asking one follow-up question about the other person\'s work, using their name twice. Record it.',
        question: 'What did Carnegie call the sweetest sound to a person?', answer: 'Their own name.',
      },
      {
        id: 'voss-mirror-label', title: 'Mirror and label',
        source: { title: 'Never Split the Difference', author: 'Chris Voss', book: true },
        idea: 'Former FBI negotiator Chris Voss uses two simple tools. Mirroring: repeat the last one to three words someone said, as a question, and they will expand. Labelling: name their feeling ("It seems like…", "It sounds like…") so they feel understood. Both keep the other person talking without you interrogating them.',
        cheat: ['Mirror: repeat their last 1 to 3 words, then wait', 'Label: "It seems like…" / "It sounds like…"', 'Then stay quiet and let them fill the silence'],
        exercise: 'Imagine a client says "The timeline is really tight for us." Practise a mirror and a label in response, out loud.',
        question: 'What is a mirror?', answer: 'Repeating the last one to three words the person said, so they keep talking.',
      },
      {
        id: 'momtest-questions', title: 'Ask about their life, not your idea',
        source: { title: 'The Mom Test', author: 'Rob Fitzpatrick', book: true },
        idea: 'Rob Fitzpatrick\'s three rules for customer conversations: talk about their life instead of your idea, ask about specifics in the past instead of generics or opinions about the future, and talk less and listen more. Compliments and "I would buy that" are not data.',
        cheat: ['Their life, not your idea', 'Specific past behaviour, not future promises', 'Talk less, listen more', 'Ignore compliments; dig for facts'],
        exercise: 'Write three customer-discovery questions for a tutor or parent that pass the Mom Test, then ask them aloud as if in a call.',
        question: 'What are the three Mom Test rules?', answer: 'Talk about their life not your idea; ask about specifics in the past; talk less and listen more.',
      },
      {
        id: 'thiel-secret', title: 'Have a contrarian truth',
        source: { title: 'Zero to One', author: 'Peter Thiel with Blake Masters', book: true },
        idea: 'Peter Thiel\'s favourite interview question is "What important truth do very few people agree with you on?" A good answer takes a clear position others disagree with. Having one makes you memorable in conversations and pitches, because it gives people something to react to.',
        cheat: ['Know your contrarian truth', 'Say it plainly, then give your evidence', 'Invite pushback; it starts real conversations'],
        exercise: 'Answer Thiel\'s question about education or AI tutoring in 60 seconds: the truth, why, and one piece of evidence.',
        question: 'What is Thiel\'s interview question?', answer: '"What important truth do very few people agree with you on?"',
      },
      {
        id: 'lean-mvp', title: 'Pitch as an experiment',
        source: { title: 'The Lean Startup', author: 'Eric Ries', book: true },
        idea: 'Eric Ries frames a startup as a loop: build, measure, learn. A minimum viable product is the smallest thing that lets you learn whether your idea works. Talking about your work as a set of experiments and what you learned sounds more credible than a list of features.',
        cheat: ['Build, measure, learn', 'MVP: the smallest thing that tests the riskiest assumption', 'Pitch what you learned, not just what you built'],
        exercise: 'Describe a project you built this year in 60 seconds as an experiment: the assumption, what you built to test it, and what you learned.',
        question: 'What is the Lean Startup loop?', answer: 'Build, measure, learn.',
      },
    ],
  },
};

async function loadState() { return (await readJSON(STATE, {})) || {}; }

// Today's lesson: the first one not done yet, but only one new lesson per day.
export async function journeyStatus(name = 'speaking') {
  const j = JOURNEYS[name]; if (!j) return { error: `no journey ${name}` };
  const st = (await loadState())[name] || { done: {}, posted: {} };
  const done = st.done || {};
  const today = localDay();
  const doneToday = Object.values(done).some(at => localDay(new Date(at).getTime()) === today);
  const idx = j.lessons.findIndex(l => !done[l.id]);
  const current = idx >= 0 ? j.lessons[idx] : null;
  return {
    journey: name, title: j.title, blurb: j.blurb, total: j.lessons.length,
    completed: Object.keys(done).length, done_today: doneToday,
    // After finishing today's lesson the next one waits for tomorrow.
    today: current && !doneToday ? { day: idx + 1, ...current } : null,
    next_up: current && doneToday ? { day: idx + 1, title: current.title } : null,
    finished: !current,
    done_ids: Object.keys(done),
  };
}

// Make sure today's lesson card is in the feed (once per lesson).
export async function ensureTodaysLesson(name = 'speaking') {
  const s = await journeyStatus(name);
  if (!s.today) return { ok: true, posted: null, why: s.finished ? 'finished' : 'done today' };
  const all = await loadState();
  const st = all[name] = all[name] || { started: new Date().toISOString(), done: {}, posted: {} };
  st.posted = st.posted || {};
  if (st.posted[s.today.id]) return { ok: true, posted: st.posted[s.today.id], existing: true };
  const l = s.today;
  const res = await handleFeedCall('feed_post', {
    kind: 'lesson', title: l.title,
    hook: `Day ${s.today.day} of ${s.total} · ${JOURNEYS[name].title}`,
    body: l.idea,
    lesson: { journey: name, id: l.id, day: s.today.day, of: s.total, cheat: l.cheat, exercise: l.exercise, question: l.question, answer: l.answer, source: l.source },
    book: l.source.book ? { title: l.source.title, author: l.source.author } : undefined,
    sources: l.source.url ? [{ title: `${l.source.title} · ${l.source.author}`, url: l.source.url }] : [],
    tags: ['lesson', 'speaking'], source: 'journey',
  });
  if (!res?.ok) return res;
  st.posted[l.id] = res.id;
  await writeJSON(STATE, all);
  return { ok: true, posted: res.id };
}

export async function completeLesson(name = 'speaking', id) {
  const j = JOURNEYS[name]; if (!j) return { error: `no journey ${name}` };
  if (!j.lessons.some(l => l.id === id)) return { error: `no lesson ${id}` };
  const all = await loadState();
  const st = all[name] = all[name] || { started: new Date().toISOString(), done: {}, posted: {} };
  st.done = st.done || {};
  if (!st.done[id]) st.done[id] = new Date().toISOString();
  await writeJSON(STATE, all);
  return { ok: true, ...(await journeyStatus(name)) };
}

export const JOURNEY_TOOLS = [
  {
    name: 'journey_status',
    description: 'The speaking journey (a RiseGuide-style path, one lesson a day): progress, today\'s lesson if one is unlocked, and what is next. Generators read it to build around the lesson of the day.',
    inputSchema: { type: 'object', properties: { journey: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'journey_complete',
    description: 'Mark a journey lesson complete (the user does this from the lesson card). The next lesson unlocks the following day.',
    inputSchema: { type: 'object', properties: { journey: { type: 'string' }, lesson_id: { type: 'string' } }, required: ['lesson_id'], additionalProperties: false },
  },
];

export async function handleJourneyCall(name, args = {}) {
  switch (name) {
    case 'journey_status': return await journeyStatus(args.journey || 'speaking');
    case 'journey_complete': {
      const r = await completeLesson(args.journey || 'speaking', String(args.lesson_id || ''));
      return r;
    }
    default: return undefined;
  }
}
