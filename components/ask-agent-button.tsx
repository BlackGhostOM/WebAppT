"use client";

import { useMutation } from "convex/react";
import { SparklesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n";

/**
 * Sends a pre-filled request to the executive agent (the only entry point for
 * owner requests) and jumps to the chat to watch it being distributed.
 */
export function AskAgentButton({ label, template, description }: { label: string; template: string; description?: string }) {
  const { t } = useT();
  const router = useRouter();
  const send = useMutation(api.chat.send);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(template);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await send({ message: text });
      setOpen(false);
      router.push("/chat");
    } catch (e) {
      toast.error((e as { data?: { message?: string } }).data?.message ?? (e instanceof Error ? e.message : t.common.error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <SparklesIcon data-icon="inline-start" /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>{description ?? "يستقبل الوكيل التنفيذي الطلب ويوزّعه على الوكيل المختص؛ كل ما يمس المال أو العملاء يعود إليك للاعتماد."}</DialogDescription>
          </DialogHeader>
          <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button onClick={submit} disabled={busy || !text.trim()}>
              {t.common.send}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
