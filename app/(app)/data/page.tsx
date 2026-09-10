"use client";

import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ENTITIES, ENTITY_KEYS } from "@/lib/entities";
import { useT } from "@/lib/i18n";

export default function DataIndexPage() {
  const { t, locale } = useT();
  return (
    <div className="space-y-4">
      <PageHeader title={t.data.title} description="نماذج مبنية من مخطط البيانات وقاموس البيانات: حقول إلزامية، قوائم معيارية، تحقق فوري، عملات متعددة والريال العُماني أساساً. كل ما تُدخله يُوسم مصدراً بشرياً موثوقاً ويمر بطبقة الخدمات والتدقيق." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ENTITY_KEYS.map((key) => {
          const def = ENTITIES[key];
          return (
            <Link key={key} href={`/data/${key}`}>
              <Card className="h-full transition-colors hover:bg-muted">
                <CardHeader>
                  <CardTitle className="text-base">{locale === "ar" ? def.labelAr : def.labelEn}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  <div>{def.domain}</div>
                  <div>
                    {def.fields.length} حقلاً · مالك البيانات: {def.dataOwnerAgent}
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
