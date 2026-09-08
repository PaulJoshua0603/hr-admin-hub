"use client";

import { Card, SectionHeading } from "@/components/ui";

export default function ReportsPage() {
  return (
    <div>
      <SectionHeading
        title="Reports"
        subtitle="Report generation is temporarily disabled."
      />
      <Card>
        <p className="text-sm text-ink-muted">
          The report generation feature has been temporarily removed while
          employee data is being updated in bulk. It will be re-enabled once
          the Employees section is finalized.
        </p>
      </Card>
    </div>
  );
}
