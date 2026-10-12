"use client";

import { useState } from "react";
import type { ShippingAddress } from "@/lib/orders/types";
import {
  formatMoney,
  selectedAddonCents,
  type AddonOption,
  type PreviewOrder,
} from "./preview-order";

export type CheckoutBody = {
  addons: string[];
  shippingAddress?: {
    name: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
};

export type AddressDraft = {
  name: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type AddonPanelState = {
  options: AddonOption[];
  selected: string[];
  address: AddressDraft;
  error: string | null;
  pending: boolean;
  totalCents: number;
  toggle: (id: string) => void;
  setField: (field: keyof AddressDraft, value: string) => void;
  purchase: () => void;
};

const fieldClass =
  "h-9 w-full rounded-[var(--cp-radius)] border border-line bg-bg px-2.5 text-[13px] text-ink outline-none focus:border-primary";

export function checkoutPayload(
  options: readonly AddonOption[],
  selectedIds: readonly string[],
  address: AddressDraft,
): CheckoutBody {
  const selected = new Set(selectedIds);
  const addons = options.map((option) => option.id).filter((id) => selected.has(id));
  if (!addons.includes("mail")) return { addons };
  const line2 = address.line2.trim();
  return {
    addons,
    shippingAddress: {
      name: address.name.trim(),
      line1: address.line1.trim(),
      line2: line2 ? line2 : null,
      city: address.city.trim(),
      state: address.state.trim().toUpperCase(),
      postalCode: address.postalCode.trim(),
      country: address.country.trim().toUpperCase(),
    },
  };
}

function emptyAddress(stored: ShippingAddress | null | undefined): AddressDraft {
  return {
    name: stored?.name ?? "",
    line1: stored?.line1 ?? "",
    line2: stored?.line2 ?? "",
    city: stored?.city ?? "",
    state: stored?.state ?? "",
    postalCode: stored?.postalCode ?? "",
    country: stored?.country ?? "US",
  };
}

export function useAddonPanel(
  order: PreviewOrder,
  onBuy?: (body: CheckoutBody) => void | Promise<void>,
): AddonPanelState {
  const options = order.addonOptions ?? [];
  const [selected, setSelected] = useState<string[]>(order.addons ?? []);
  const [address, setAddress] = useState<AddressDraft>(() => emptyAddress(order.shippingAddress));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const totalCents = order.pricing.totalCents + selectedAddonCents(options, selected);

  function toggle(id: string) {
    setError(null);
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function setField(field: keyof AddressDraft, value: string) {
    setError(null);
    const next = field === "state" || field === "country" ? value.toUpperCase() : value;
    setAddress((current) => ({ ...current, [field]: next }));
  }

  async function purchase() {
    setPending(true);
    setError(null);
    try {
      await onBuy?.(checkoutPayload(options, selected, address));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Payment could not start.");
    } finally {
      setPending(false);
    }
  }

  return {
    options,
    selected,
    address,
    error,
    pending,
    totalCents,
    toggle,
    setField,
    purchase: () => {
      void purchase();
    },
  };
}

export function AddonPanel({ panel }: { panel: AddonPanelState }) {
  if (panel.options.length === 0) return null;
  const mail = panel.options.find((option) => option.id === "mail");
  const showAddress = Boolean(mail && panel.selected.includes(mail.id));

  return (
    <fieldset data-testid="addon-panel" className="rounded-[var(--cp-radius)] border border-line">
      <legend className="preview-kicker px-2">Add-ons</legend>
      <ul>
        {panel.options.map((option) => {
          const checked = panel.selected.includes(option.id);
          const price =
            option.totalCents == null ? "Pending" : formatMoney(option.totalCents);
          return (
            <li key={option.id} className="border-t border-line first:border-t-0">
              <label className="flex cursor-pointer items-start gap-2.5 px-3.5 py-2.5">
                <input
                  type="checkbox"
                  data-testid={`addon-${option.id}`}
                  checked={checked}
                  onChange={() => panel.toggle(option.id)}
                  className="mt-0.5 size-4 accent-[var(--cp-primary)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{option.label}</span>
                  <span className="block text-[11px] text-ink-muted">
                    {option.per === "page" ? `${formatMoney(option.unitCents)} per page` : "per order"}
                  </span>
                </span>
                <span className="text-sm font-semibold">{price}</span>
              </label>
              {option.id === "mail" && showAddress ? (
                <AddressForm panel={panel} />
              ) : null}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function AddressForm({ panel }: { panel: AddonPanelState }) {
  return (
    <div data-testid="shipping-address" className="grid gap-2 px-3.5 pb-3">
      <Field label="Full name" value={panel.address.name} onChange={(value) => panel.setField("name", value)} />
      <Field
        label="Street address"
        value={panel.address.line1}
        onChange={(value) => panel.setField("line1", value)}
      />
      <Field
        label="Apt, suite"
        optional
        value={panel.address.line2}
        onChange={(value) => panel.setField("line2", value)}
      />
      <Field label="City" value={panel.address.city} onChange={(value) => panel.setField("city", value)} />
      <div className="grid grid-cols-[72px_minmax(0,1fr)_72px] gap-2">
        <Field
          label="State"
          value={panel.address.state}
          maxLength={2}
          onChange={(value) => panel.setField("state", value)}
        />
        <Field
          label="ZIP code"
          value={panel.address.postalCode}
          onChange={(value) => panel.setField("postalCode", value)}
        />
        <Field
          label="Country"
          value={panel.address.country}
          maxLength={2}
          onChange={(value) => panel.setField("country", value)}
        />
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  optional,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  optional?: boolean;
  maxLength?: number;
}) {
  const id = `ship-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-[11px] font-semibold">
        {label}
        {optional ? <span className="font-normal text-ink-muted"> Optional</span> : null}
      </span>
      <input
        id={id}
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        className={fieldClass}
      />
    </label>
  );
}

export function AddonTotal({ panel }: { panel: AddonPanelState }) {
  const chosen = panel.options.filter(
    (option) => panel.selected.includes(option.id) && option.totalCents != null,
  );
  return (
    <>
      {chosen.map((option) => (
        <div key={option.id} className="flex justify-between border-t border-line px-3.5 py-[11px]">
          <span>{option.label}</span>
          <span>{formatMoney(option.totalCents ?? 0)}</span>
        </div>
      ))}
      <div className="flex justify-between border-t border-line px-3.5 py-[11px] text-base font-bold">
        <span>Total</span>
        <span>{formatMoney(panel.totalCents)}</span>
      </div>
    </>
  );
}

export function AddonError({ panel }: { panel: AddonPanelState }) {
  if (!panel.error) return null;
  return (
    <p data-testid="addon-error" role="alert" className="text-xs text-[var(--cp-warn)]">
      {panel.error}
    </p>
  );
}
