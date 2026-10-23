import type { Employee } from "@/types";
import { formatDate } from "@/lib/dates";
import { relieverTag } from "@/lib/employeeStatus";

/**
 * "Temporary Reliever" (amber) or "Absorbed · Dec 3, 2026" (green) beside an employee's
 * name — nothing for anyone who was never a reliever. Used wherever employees are listed
 * so the two read the same everywhere.
 */
export function RelieverTag({
  tag,
  absorbedDate,
  className = "ml-2",
}: {
  tag?: string;
  absorbedDate?: string;
  className?: string;
}) {
  if (!tag) return null;
  const absorbed = tag === "Absorbed";
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${
        absorbed ? "bg-success-soft text-success ring-success/20" : "bg-warn-soft text-warn ring-warn/20"
      } ${className}`}
      title={absorbed && absorbedDate ? `Absorbed on ${formatDate(absorbedDate, "MMMM d, yyyy")}` : undefined}
    >
      {absorbed && absorbedDate ? `Absorbed · ${formatDate(absorbedDate, "MMM d, yyyy")}` : tag}
    </span>
  );
}

/** The same tag, worked out from the employee record. */
export function EmployeeRelieverTag({ employee, className }: { employee: Employee; className?: string }) {
  return (
    <RelieverTag
      tag={relieverTag(employee) || undefined}
      absorbedDate={employee.relieverAbsorbedDate}
      className={className}
    />
  );
}
