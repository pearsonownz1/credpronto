export type SampleCourse = {
  name: string;
  english: string;
  credits: string;
  grade: string;
  usHours: string;
  usGrade: string;
  points: string;
};

export type SampleYear = {
  label: string;
  courses: SampleCourse[];
};

/** Example diploma evaluation shown on the marketing page. */
export const DIPLOMA_SAMPLE = {
  reportId: "CP-E-10482",
  kind: "Diploma evaluation",
  issued: "Oct 11, 2026",
  title: "Educational Credential Evaluation",
  preparedFor: "María Fernanda Ruiz Delgado",
  purpose: "Employment",
  equivalency:
    "Bachelor's degree in Industrial Engineering from a regionally accredited institution in the United States",
  applicant: [
    ["Name", "María Fernanda Ruiz Delgado"],
    ["Date of birth", "September 19, 1996"],
    ["Country of education", "Mexico"],
  ],
  credential: [
    ["Credential", "Título de Ingeniera Industrial"],
    ["Institution", "Universidad Autónoma de Guadalajara"],
    ["Institution status", "Recognized by the Secretaría de Educación Pública"],
    ["Program length", "4.5 years (9 semesters)"],
    ["Admission requirement", "Bachillerato (equivalent to U.S. high school diploma)"],
    ["Date awarded", "June 28, 2019"],
  ],
  documents: [
    ["Original", "Título profesional (Spanish), 1 page"],
    ["Translation", "Certified English translation, CredPronto CP-24817"],
  ],
  advisory:
    "This evaluation is advisory and based on the documents submitted. Acceptance is at the discretion of the receiving institution or agency.",
  page: "Page 1 of 1",
} as const;

/** Example course-by-course evaluation shown on the marketing page. */
export const COURSE_SAMPLE = {
  reportId: "CP-E-10483",
  kind: "Course-by-course evaluation",
  issued: "Oct 11, 2026",
  title: "Course-by-Course Evaluation",
  subject: "María Fernanda Ruiz Delgado · Universidad Autónoma de Guadalajara, Mexico",
  equivalency: "Bachelor's degree in Industrial Engineering",
  semesterHours: "142.0",
  gpa: "3.36",
  years: [
    {
      label: "Year 1 · 2015–2016",
      courses: [
        course("Cálculo Diferencial", "Differential Calculus", "8", "9.2", "4.0", "A", "4.0"),
        course("Química General", "General Chemistry", "8", "8.4", "4.0", "B", "3.0"),
        course("Programación I", "Programming I", "6", "9.6", "3.0", "A", "4.0"),
      ],
    },
    {
      label: "Year 2 · 2016–2017",
      courses: [
        course("Cálculo Integral", "Integral Calculus", "8", "8.9", "4.0", "B+", "3.3"),
        course("Física I", "Physics I", "8", "9.5", "4.0", "A", "4.0"),
        course("Termodinámica", "Thermodynamics", "8", "7.2", "4.0", "C", "2.0"),
      ],
    },
    {
      label: "Year 3 · 2017–2018",
      courses: [
        course("Investigación de Operaciones", "Operations Research", "8", "9.4", "4.0", "A", "4.0"),
        course("Ingeniería de Métodos", "Methods Engineering", "6", "8.7", "3.0", "B+", "3.3"),
        course("Control de Calidad", "Quality Control", "6", "9.1", "3.0", "A", "4.0"),
      ],
    },
  ] satisfies SampleYear[],
  more: "… 40 more courses continue on pages 2–3 …",
  totalCredits: "284",
  totalHours: "142.0",
  totalGpa: "3.36",
  scale:
    "Grade scale: Mexico 0–10. 9.0–10 = A, 8.5–8.9 = B+, 8.0–8.4 = B, 7.0–7.9 = C, 6.0–6.9 = D, below 6.0 = F. Credits converted at 2 local credits = 1 U.S. semester hour. The GPA shown is for this example.",
  page: "Page 1 of 3",
} as const;

function course(
  name: string,
  english: string,
  credits: string,
  grade: string,
  usHours: string,
  usGrade: string,
  points: string,
): SampleCourse {
  return { name, english, credits, grade, usHours, usGrade, points };
}
