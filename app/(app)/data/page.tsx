"use client";

import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { AgentBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";
import { ENTITIES, ENTITY_KEYS } from "@/lib/entities";
import { labelOf, useT } from "@/lib/i18n";

export default function DataIndexPage() {
  const { t, locale } = useT();
  return (
    <div className="space-y-6">
      <PageHeader title={t.data.title} description={t.data.description} />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ENTITY_KEYS.map((key) => {
          const def = ENTITIES[key];
          return (
            <li key={key}>
              <Link
                href={`/data/${key}`}
                className="group flex h-full flex-col justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-xs transition-colors hover:border-ring/40 hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-heading text-base font-semibold">{locale === "ar" ? def.labelAr : def.labelEn}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{labelOf(def.domain, locale)}</div>
                  </div>
                  <ChevronLeftIcon
                    className="size-4 shrink-0 text-hint transition-transform group-hover:-translate-x-0.5 ltr:rotate-180 ltr:group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {def.fields.length} {t.data.fields}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    {t.data.dataOwner}: <AgentBadge slug={def.dataOwnerAgent} />
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
