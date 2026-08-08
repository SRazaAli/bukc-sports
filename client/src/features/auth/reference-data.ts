/**
 * Static reference data hardcoded from the BUKC prospectus screenshots.
 * Department is the parent grouping; each maps to its degree programs. The
 * registration form cascades: pick a department, the program list narrows.
 */
export interface Department {
  name: string;
  programs: string[];
}

export const DEPARTMENTS: Department[] = [
  { name: 'Business Studies', programs: ['ADP Business Administration', 'Bachelor in Business Administration'] },
  { name: 'Computer Engineering', programs: ['Bachelor of Computer Engineering'] },
  { name: 'Computer Science', programs: ['Associate Degree Program (CS)', 'BS Artificial Intelligence', 'BS Computer Science', 'BS Information Technology'] },
  { name: 'Earth & Environmental Sciences', programs: ['BS Environmental Science', 'BS Geosciences', 'BS Remote Sensing & GIS'] },
  { name: 'Electrical Engineering', programs: ['Bachelor of Electrical Engineering (BEE)', 'BS Robotics and Intelligent Systems'] },
  { name: 'Humanities & Social Sciences', programs: ['Bachelor in Social Sciences', 'Bachelor of Studies in English'] },
  { name: 'Islamic Studies', programs: ['BS (Islamic Studies)'] },
  { name: 'Management Studies', programs: ['BS Accounting and Finance', 'BS in Business Analytics', 'BS in Economics and Finance', 'BS Supply Chain Management'] },
  { name: 'Maritime Sciences', programs: ['BS (Coastal and Marine Sciences)', 'BS Maritime Business and Management (2 Years)', 'BS Maritime Business and Management (4 Years)'] },
  { name: 'Media Studies', programs: ['BS Media and Communication Studies'] },
  { name: 'Software Engineering', programs: ['Bachelor of Software Engineering (BSE)'] },
];

/**
 * Institutes/campuses. Karachi Campus is the only one this platform serves, so
 * it is preselected and every other option is disabled (shown, not selectable).
 */
export const INSTITUTES: string[] = [
  'Bahria University College of Nursing',
  'Finishing School',
  'Health Sciences Campus (Islamabad)',
  'Health Sciences Campus (Karachi)',
  'IPP (Karachi)',
  'Islamabad E-8 Campus',
  'Islamabad H-11 Campus',
  'Karachi Campus',
  'Lahore Campus',
  'NATIONAL SCHOOL OF HYDROGRAPHY',
  'NCMPR',
  'ODL',
  'PN Nursing College',
  'PN School Of Logistics',
];

export const DEFAULT_INSTITUTE = 'Karachi Campus';

/**
 * Universities offered in the External registration form's Institution
 * dropdown. "Other" is appended in the form itself (not stored here) — when
 * selected, a free-text field opens so an institution outside this list can
 * still be entered and submitted.
 */
export const EXTERNAL_UNIVERSITIES: string[] = [
  'University of Karachi',
  'NED University of Engineering and Technology',
  'Dow University of Health Sciences',
  'Jinnah Sindh Medical University',
  'Institute of Business Administration (IBA)',
  'Aga Khan University',
  'Habib University',
  'FAST National University of Computer and Emerging Sciences',
  'Iqra University',
  'Institute of Business Management (IoBM)',
  'Hamdard University',
  'Bahria University Karachi Campus',
  'Sir Syed University of Engineering and Technology',
  'DHA Suffa University',
  'Mohammad Ali Jinnah University',
  'SZABIST (Shaheed Zulfikar Ali Bhutto Institute of Science and Technology)',
  'Karachi Institute of Economics and Technology (KIET)',
  'Indus University',
  'Benazir Bhutto Shaheed University Lyari',
  'Greenwich University',
  'Preston University Karachi',
  'Ziauddin University',
  'Karachi Medical and Dental College',
  'Baqai Medical University',
  'Federal Urdu University of Arts, Science and Technology (FUUAST)',
  'Dawood University of Engineering and Technology',
  'Benazir Bhutto Shaheed University Karachi',
  'Sindh Madressatul Islam University (SMIU)',
  'Textile Institute of Pakistan (TIP)',
  'Ilma University',
  'The University of Faisal (Karachi Campus)',
  'Al-Tibri Medical College and Hospital',
  'Jinnah University for Women',
  'KASBIT (Khadim Ali Shah Bukhari Institute of Technology)',
  'Usman Institute of Technology (UIT University)',
  'Karachi School of Business & Leadership (KSBL)',
];
