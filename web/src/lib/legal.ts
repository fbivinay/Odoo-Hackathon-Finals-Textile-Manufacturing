// The two documents behind Settings. Written for the people who use this system every day:
// a short "in short" on top, then numbered sections of plain sentences. Keep both true to what
// the system really does; if a feature changes how data is kept or shared, change the text here.

export interface LegalDoc {
  title: string
  updated: string // shown as "Last updated …"
  intro: string
  inShort: string[]
  sections: { heading: string; points: string[] }[]
}

const CONTACT = 'the mill owner (owner@everest.dev)'

export const PRIVACY: LegalDoc = {
  title: 'Privacy Policy',
  updated: '10 Oct 2026',
  intro: 'How Everest Textile Mills handles your information in this system.',
  inShort: [
    'We keep only what is needed to run the mill and to know who did what.',
    'You see only the sections your role, or the owner, gives you.',
    'Your password is stored scrambled. Nobody, including the owner, can read it.',
    'Questions and pictures you send to Ask Everest are processed by Google’s AI service.',
  ],
  sections: [
    {
      heading: 'What we keep about you',
      points: [
        'Your name, work email, role, any additional access, and the date your login was added.',
        'Your password, stored only in scrambled (hashed) form.',
        'Your name on some of the work you record: stock you receive, purchase orders you place and rolls you inspect.',
        'For workers on the floor: name, shift, daily wage, attendance and wage payments.',
        'For buyers and suppliers: business name, phone number and email.',
      ],
    },
    {
      heading: 'Why we keep it',
      points: [
        'To sign you in and show you the right sections.',
        'To keep a true record of stock, production, quality and dispatch.',
        'To work out wages, raise invoices and track payments.',
        'We do not use it for advertising and we do not sell it.',
      ],
    },
    {
      heading: 'Who can see it',
      points: [
        'The owner can see everything, including profit, costs, wages and all logins.',
        'Everyone else sees only the sections their role opens, plus any the owner has added for them.',
        'A buyer holding a tracking link sees the progress of that one order and nothing else.',
      ],
    },
    {
      heading: 'Ask Everest, the AI assistant',
      points: [
        'What you type, any picture you attach, and the figures it looks up for you are sent to Google’s Gemini service to write the answer. Google handles that data under its own terms.',
        'It can only look up what you are already allowed to see.',
        'Do not send personal photos or anything unrelated to the mill.',
        'Chats are not saved by this system. They clear when you refresh the page or log out.',
      ],
    },
    {
      heading: 'How we keep it safe',
      points: [
        'Passwords are hashed, and a login given by the owner must be changed at first sign-in.',
        'Every request is checked on the server against your role. Hiding a menu is not the only lock.',
        'Sign-in lasts one day, and repeated sign-in attempts are limited.',
        'Your sign-in is remembered in this browser. On a shared computer, always log out.',
        'No advertising or tracking cookies are used.',
      ],
    },
    {
      heading: 'How long we keep it',
      points: [
        'Your login details stay while you work with the mill. A deactivated login can no longer sign in.',
        'Records of work done (stock, production, quality, dispatch, wages) stay as part of the mill’s books.',
      ],
    },
    {
      heading: 'Your rights',
      points: [
        'Under India’s Digital Personal Data Protection Act, 2023 you can ask what personal data we hold about you, ask us to correct or update it, ask us to erase what is no longer needed, and withdraw a consent you gave.',
        `To use any of these, or to raise a concern, contact ${CONTACT}. We aim to reply within 7 days.`,
        'If you are not satisfied with the reply, you can complain to the Data Protection Board of India.',
      ],
    },
    {
      heading: 'Changes',
      points: ['If this policy changes, the date at the top changes and the owner will tell you what is different.'],
    },
  ],
}

export const TERMS: LegalDoc = {
  title: 'Terms & Conditions',
  updated: '10 Oct 2026',
  intro: 'The rules for using the Everest Textile Mills system.',
  inShort: [
    'This system is for mill work only.',
    'Your login is yours alone. Do not share it.',
    'Enter what actually happened. The records are the mill’s books.',
    'The owner can change or remove your access at any time.',
  ],
  sections: [
    {
      heading: 'Who can use it',
      points: ['Only people the owner has given a login to, and only for the work of Everest Textile Mills.'],
    },
    {
      heading: 'Your login',
      points: [
        'Set your own password at first sign-in and keep it to yourself.',
        'Do not let anyone else work under your name. What is entered with your login is recorded as yours.',
        'Log out on shared computers. Tell the owner at once if you think someone else has used your login.',
      ],
    },
    {
      heading: 'Using it properly',
      points: [
        'Record stock, production, quality checks and dispatches as they really happened, at the time they happen.',
        'Do not change or invent entries to hide a mistake, a shortage or a defect. Report it instead.',
        'Do not try to open sections you have not been given.',
        'Do not copy or share mill information (buyers, prices, costs, wages) outside the mill.',
      ],
    },
    {
      heading: 'Ask Everest, the AI assistant',
      points: [
        'It answers from the mill’s own data, but it can still be wrong. Check the figure on the screen before acting on money, stock or dispatch decisions.',
        'Ask it only about the mill. It cannot change any data.',
        'Do not attach pictures unrelated to mill work.',
      ],
    },
    {
      heading: 'Who owns the data',
      points: ['Everything entered into the system belongs to Everest Textile Mills.'],
    },
    {
      heading: 'Changes to your access',
      points: [
        'The owner may change your role, add or remove access, reset your password or deactivate your login at any time.',
        'Your access ends when you stop working with the mill.',
      ],
    },
    {
      heading: 'Availability',
      points: ['The system may be unavailable at times for maintenance or faults. Report problems to the owner; do not work around them by sharing logins.'],
    },
    {
      heading: 'If these rules are broken',
      points: ['Your access can be removed, and the matter handled under the mill’s rules and the law.'],
    },
    {
      heading: 'Changes and law',
      points: [
        'These terms may be updated; the date at the top shows the latest version. Continuing to use the system means you accept them.',
        `They are governed by the laws of India. Questions go to ${CONTACT}.`,
      ],
    },
  ],
}
