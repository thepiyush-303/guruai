// ============================================================
// openCategories.ts — free-form chat outside any syllabus. Each category
// tunes the teacher a little (promptHint) and offers a few "try asking"
// starters in the picker.
// ============================================================

import type { OpenCategory } from './types';

export const OPEN_CATEGORIES: OpenCategory[] = [
  {
    id: 'software',
    title: 'Software & coding',
    icon: 'code',
    blurb: 'Programming, web and app development, system design, AI and tools.',
    promptHint:
      'The learner wants to talk about software: programming languages, web and app development, system design, AI/ML, tools and practices. Explain how things work and why, with everyday analogies first. Because replies are spoken, describe code in words ("a loop that goes over each item") instead of reading out symbols; say exact syntax only when it is short. Suggest a tiny practice step they can try.',
    starters: [
      'How does the internet load a web page?',
      'Explain recursion like I am new to coding',
      'What is the difference between SQL and NoSQL?',
      'How do large language models work?',
    ],
  },
  {
    id: 'hardware',
    title: 'Hardware & electronics',
    icon: 'chip',
    blurb: 'Computers, phones, circuits, Arduino, networking gear and how devices work.',
    promptHint:
      'The learner wants to understand hardware and electronics: how computers, phones and circuits work, components, building or repairing things, Arduino and Raspberry Pi. Build intuition first, then the real terms. Always mention safety when mains electricity, batteries or soldering are involved.',
    starters: [
      'How does a CPU actually run a program?',
      'What do RAM and SSD each do?',
      'How does a transistor work?',
      'Help me plan a first Arduino project',
    ],
  },
  {
    id: 'exam-prep',
    title: 'Other exam prep',
    icon: 'target',
    blurb: 'UPSC, SSC, banking, CAT, CUET, state exams — strategy and concepts.',
    promptHint:
      'The learner is preparing for a competitive or entrance exam (for example UPSC, SSC, banking, CAT, CUET, CLAT or a state exam). Find out which exam and when it is, then help with concepts, a realistic study plan, revision strategy and practice questions. Teach concepts with the usual method; for strategy be concrete and encouraging.',
    starters: [
      'Make me a 3-month plan for SSC CGL',
      'Explain the Indian Parliament for UPSC prelims',
      'How should I prepare quantitative aptitude for CAT?',
      'Give me a quick quiz on Indian geography',
    ],
  },
  {
    id: 'career',
    title: 'Career & interviews',
    icon: 'cap',
    blurb: 'Choosing a path, resumes, interviews, and skills for work.',
    promptHint:
      'The learner wants help with careers: choosing a stream or course, job roles, resumes, interview preparation and workplace skills. Ask one question at a time to understand their situation, then give practical, specific advice. For interview practice, ask one question, wait for their answer, then give kind and honest feedback.',
    starters: [
      'Practise a software interview with me',
      'Which careers suit someone who likes biology?',
      'How do I answer "Tell me about yourself"?',
      'What skills do I need to become a data analyst?',
    ],
  },
  {
    id: 'life',
    title: 'Life & wellbeing',
    icon: 'heart',
    blurb: 'Study habits, focus, stress, money basics, health and everyday life skills.',
    promptHint:
      'The learner wants to talk about everyday life: study habits, focus, stress, sleep, relationships, money basics, cooking, health and other life skills. Be warm, practical and non-judgemental, and listen before advising. Do not diagnose or prescribe; for medical, legal or mental-health concerns, gently suggest a qualified professional or a trusted adult, and if they mention being in danger or wanting to harm themselves, encourage them to contact local emergency services or a helpline right away.',
    starters: [
      'How can I stop procrastinating?',
      'I get nervous before exams — what helps?',
      'Explain how saving and interest work',
      'How do I build a good study routine?',
    ],
  },
  {
    id: 'theory',
    title: 'Theory & ideas',
    icon: 'bulb',
    blurb: 'History, economics, philosophy, psychology, space, science and big ideas.',
    promptHint:
      'The learner is curious about ideas and theory: history, economics, political science, philosophy, psychology, astronomy, science and more. Teach with the usual chunked method, give balanced views on contested topics, and separate established facts from interpretations.',
    starters: [
      'Why did the Mughal empire decline?',
      'What is inflation and why does it happen?',
      'Explain black holes simply',
      'What did Gandhi mean by satyagraha?',
    ],
  },
  {
    id: 'anything',
    title: 'Something else',
    icon: 'chat',
    blurb: 'Any question at all — just start talking.',
    promptHint:
      'The learner may ask about anything. Work out what they need: a quick answer, a proper explanation, or a conversation. Teach with the usual method when they want to understand something.',
    starters: ['Teach me something interesting today', 'Help me understand a news topic', 'Explain a word or idea I heard'],
  },
];
