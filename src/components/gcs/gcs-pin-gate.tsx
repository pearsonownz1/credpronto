"use client";

import { useState, type FormEvent } from "react";
import { publishGcsUnlock } from "@/lib/gcs/pin-client";

export function GcsPinGate({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/gcs/pin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      if (!response.ok) {
        setError(typeof body?.error === "string" ? body.error : "That PIN is not correct.");
        return;
      }
      publishGcsUnlock(true);
      onUnlock();
    } catch {
      setError("That PIN is not correct.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center px-5 py-16">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-2xl border border-[#d5dbe6] bg-white px-6 py-8 shadow-[0_18px_50px_-28px_rgba(11,18,32,0.45)]"
      >
        <p className="text-[11px] font-semibold tracking-[0.16em] text-[#1f5eff]">GEO CREDENTIAL SERVICES</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.4px] text-[#0b1220]">
          Enter 6-digit PIN to access GCS Certified Translation
        </h1>
        <label className="mt-6 block text-sm font-semibold text-[#0b1220]" htmlFor="gcs-pin">
          PIN
        </label>
        <input
          id="gcs-pin"
          name="pin"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          value={pin}
          onChange={(event) => {
            setPin(event.target.value.replace(/\D/g, "").slice(0, 6));
            setError(null);
          }}
          className="mt-2 h-14 w-full rounded-xl border border-[#d5dbe6] px-4 text-center text-2xl tracking-[0.4em] text-[#0b1220] outline-none focus:border-[#1f5eff]"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "gcs-pin-error" : undefined}
          autoFocus
        />
        {error ? (
          <p id="gcs-pin-error" role="alert" className="mt-3 text-sm font-semibold text-[#b42318]">
            {error}
          </p>
        ) : (
          <p className="mt-3 text-sm text-[#5b6474]">Use the desk PIN. It stays unlocked on this browser.</p>
        )}
        <button
          type="submit"
          disabled={pending || pin.length !== 6}
          className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#1f5eff] text-base font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Checking…" : "Submit"}
        </button>
      </form>
    </div>
  );
}
