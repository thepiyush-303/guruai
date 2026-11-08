// Competitive exams. Their syllabus is the same material as the school and
// college programs, so subjects list references instead of copying topics:
//   'cbse-11.physics'              a whole subject of a program
//   'cbse-11.physics.kinematics'   one unit of it
// index.ts resolves them; topic ids stay those of their home program.

export interface ExamSubjectSpec {
  id: string;
  title: string;
  icon: string;
  refs: string[];
}

export interface ExamSpec {
  id: string;
  title: string;
  note: string;
  grade?: string;
  subjects: ExamSubjectSpec[];
}

export const exams: ExamSpec[] = [
  {
    id: 'jee-main',
    title: 'JEE Main',
    note: 'Engineering entrance · Class 11 + 12 PCM',
    grade: '12',
    subjects: [
      { id: 'physics', title: 'Physics', icon: 'atom', refs: ['cbse-11.physics', 'cbse-12.physics'] },
      { id: 'chemistry', title: 'Chemistry', icon: 'flask', refs: ['cbse-11.chemistry', 'cbse-12.chemistry'] },
      { id: 'maths', title: 'Mathematics', icon: 'sigma', refs: ['cbse-11.maths', 'cbse-12.maths'] },
    ],
  },
  {
    id: 'neet',
    title: 'NEET UG',
    note: 'Medical entrance · Class 11 + 12 PCB',
    grade: '12',
    subjects: [
      { id: 'physics', title: 'Physics', icon: 'atom', refs: ['cbse-11.physics', 'cbse-12.physics'] },
      { id: 'chemistry', title: 'Chemistry', icon: 'flask', refs: ['cbse-11.chemistry', 'cbse-12.chemistry'] },
      { id: 'biology', title: 'Biology', icon: 'leaf', refs: ['cbse-11.biology', 'cbse-12.biology'] },
    ],
  },
  {
    id: 'gate-cs',
    title: 'GATE CS',
    note: 'Postgraduate entrance · Computer Science',
    grade: 'college',
    subjects: [
      { id: 'discrete', title: 'Discrete Mathematics', icon: 'sigma', refs: ['btech-cse.discrete'] },
      { id: 'digital', title: 'Digital Logic', icon: 'chip', refs: ['btech-cse.digital'] },
      { id: 'coa', title: 'Computer Organisation', icon: 'chip', refs: ['btech-cse.coa'] },
      { id: 'dsa', title: 'Programming, DS & Algorithms', icon: 'code', refs: ['btech-cse.dsa'] },
      { id: 'os', title: 'Operating Systems', icon: 'chip', refs: ['btech-cse.os'] },
      { id: 'dbms', title: 'Databases', icon: 'book', refs: ['btech-cse.dbms'] },
      { id: 'networks', title: 'Computer Networks', icon: 'globe', refs: ['btech-cse.networks'] },
    ],
  },
];
