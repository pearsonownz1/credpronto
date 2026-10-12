import { COURSE_SAMPLE } from "@/lib/evaluations/sample";
import { ReportPage, ReportSignature, ReportTop } from "./report-chrome";

export function CourseSample() {
  const sample = COURSE_SAMPLE;
  return (
    <ReportPage>
      <ReportTop reportId={sample.reportId} kind={sample.kind} issued={sample.issued} />
      <h2 className="mt-[22px] mb-1 text-[22px] font-bold tracking-[-0.4px]">{sample.title}</h2>
      <p className="mb-[18px] text-ink-muted">{sample.subject}</p>
      <div className="mb-4 grid grid-cols-[2fr_1fr_1fr] gap-3">
        <div className="rounded-[var(--cp-radius)] border border-[#c9d6ff] bg-[var(--cp-blue-l)] px-[18px] py-4">
          <p className="text-[11px] font-semibold tracking-[0.06em] text-primary uppercase">
            U.S. equivalency
          </p>
          <p className="mt-1 text-[15px] leading-snug font-bold tracking-[-0.3px]">
            {sample.equivalency}
          </p>
        </div>
        <Stat label="Semester hours" value={sample.semesterHours} />
        <Stat label="U.S. GPA" value={sample.gpa} />
      </div>
      <div className="overflow-hidden rounded-[var(--cp-radius)] border border-line">
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr>
              <th className="bg-bg-muted px-2.5 py-[7px] text-left text-[10.5px] font-semibold tracking-[0.04em] text-ink-muted uppercase">
                Course
              </th>
              {["Credits", "Grade", "U.S. sem. hrs", "U.S. grade", "Points"].map((heading) => (
                <th
                  key={heading}
                  className="bg-bg-muted px-2.5 py-[7px] text-right text-[10.5px] font-semibold tracking-[0.04em] text-ink-muted uppercase"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sample.years.map((year) => (
              <YearRows key={year.label} label={year.label} courses={year.courses} />
            ))}
            <tr>
              <td
                colSpan={6}
                className="border-b border-line px-2.5 py-1.5 text-center text-[11px] text-ink-muted"
              >
                {sample.more}
              </td>
            </tr>
            <tr className="font-bold">
              <td className="border-t-2 border-ink px-2.5 py-1.5">Total</td>
              <td className="preview-mono border-t-2 border-ink px-2.5 py-1.5 text-right">
                {sample.totalCredits}
              </td>
              <td className="border-t-2 border-ink" />
              <td className="preview-mono border-t-2 border-ink px-2.5 py-1.5 text-right">
                {sample.totalHours}
              </td>
              <td className="preview-mono border-t-2 border-ink px-2.5 py-1.5 text-right">GPA</td>
              <td className="preview-mono border-t-2 border-ink px-2.5 py-1.5 text-right">
                {sample.totalGpa}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2.5 text-[10.5px] leading-relaxed text-ink-muted">{sample.scale}</p>
      <ReportSignature reportId={sample.reportId} page={sample.page} />
    </ReportPage>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--cp-radius)] border border-line bg-white px-[18px] py-4">
      <p className="text-[11px] font-semibold tracking-[0.06em] text-ink-muted uppercase">{label}</p>
      <p className="mt-1 text-[18px] font-bold tracking-[-0.3px]">{value}</p>
    </div>
  );
}

function YearRows({
  label,
  courses,
}: {
  label: string;
  courses: readonly {
    name: string;
    english: string;
    credits: string;
    grade: string;
    usHours: string;
    usGrade: string;
    points: string;
  }[];
}) {
  return (
    <>
      <tr>
        <td
          colSpan={6}
          className="border-b border-line bg-[#fafbfc] px-2.5 py-1.5 text-[11px] font-semibold"
        >
          {label}
        </td>
      </tr>
      {courses.map((item) => (
        <tr key={item.name}>
          <td className="border-b border-line px-2.5 py-1.5">
            {item.name}
            <div className="text-[10.5px] text-ink-muted">{item.english}</div>
          </td>
          {[item.credits, item.grade, item.usHours, item.usGrade, item.points].map((value, index) => (
            <td
              key={`${item.name}-${index}`}
              className="preview-mono border-b border-line px-2.5 py-1.5 text-right"
            >
              {value}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
