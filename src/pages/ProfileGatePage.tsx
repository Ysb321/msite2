"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import { PencilIcon, PlusIcon, XIcon } from "@/components/Icons";
import {
  getProfiles, setProfiles, getActiveProfile, setActiveProfile,
  onProfilesChange, type Profile,
} from "@/lib/storage";

const COLORS = ["#5e17eb", "#e50914", "#1a9c5b", "#f5a623", "#0f7fd4", "#d64578", "#6b7280", "#8b5cf6"];

export default function ProfileGate() {
  const router = useRouter();
  const [profiles, setLocal] = useState<Profile[]>([]);
  const [manage, setManage] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(COLORS[4]);

  useEffect(() => {
    if (getActiveProfile()) {
      router.replace("/home");
      return;
    }
    setLocal(getProfiles());
    return onProfilesChange(setLocal);
  }, [router]);

  const pick = (p: Profile) => {
    setActiveProfile(p);
    router.push("/home");
  };

  const addProfile = () => {
    const name = newName.trim();
    if (!name) return;
    const p: Profile = { id: `p${Date.now()}`, name, color: newColor };
    const next = [...getProfiles(), p];
    setProfiles(next);
    setLocal(next);
    setAdding(false);
    setNewName("");
  };

  const remove = (id: string) => {
    if (id === "kids") return; // built-in Kids profile: non-removable
    const next = getProfiles().filter((p) => p.id !== id);
    setProfiles(next);
    setLocal(next);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-ink px-6">
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/60 to-transparent" />
      <p className="mb-1 text-3xl font-semibold text-neutral-100 md:text-5xl">Who&rsquo;s watching?</p>
      <p className="mb-6 text-sm font-medium tracking-wide text-neutral-500">Yetflix · by Yashraj</p>

      <div className="flex flex-wrap items-start justify-center gap-5 md:gap-8">
        <>
          {profiles.map((p, i) => (
            <button
              key={p.id}
              onClick={() => !manage && pick(p)}
              style={{ animationDelay: `${i * 0.07}s` }}
              className="pop-in group flex w-[104px] flex-col items-center gap-2 md:w-[138px]"
            >
              <div className="relative">
                <Avatar
                  color={p.color}
                  kids={p.kids}
                  className="h-[104px] w-[104px] md:h-[138px] md:w-[138px]"
                  rounded="rounded-xl"
                />
                <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50 opacity-0 transition group-hover:opacity-100">
                  {manage ? (
                    <XIcon className="h-10 w-10 text-white" />
                  ) : (
                    <PencilIcon className="h-10 w-10 text-white opacity-0 transition group-hover:opacity-100" />
                  )}
                </div>
              </div>
              <span className="text-[13px] text-neutral-400 transition group-hover:text-white md:text-[15px]">
                {p.name}
              </span>
              {manage && !p.fixed && (
                <button
                  onClick={(e) => { e.stopPropagation(); remove(p.id); }}
                  className="text-[11px] font-semibold text-brand hover:underline"
                >
                  DELETE
                </button>
              )}
              {manage && p.fixed && (
                <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-600">
                  locked
                </span>
              )}
            </button>
          ))}
        </>

        {profiles.length < 5 && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="group flex w-[104px] flex-col items-center gap-2 md:w-[138px]"
          >
            <div className="flex h-[104px] w-[104px] items-center justify-center rounded-xl border-2 border-transparent bg-white/5 transition group-hover:border-white md:h-[138px] md:w-[138px]">
              <PlusIcon className="h-12 w-12 text-neutral-400 transition group-hover:text-white" />
            </div>
            <span className="text-[13px] text-neutral-400 transition group-hover:text-white md:text-[15px]">Add Profile</span>
          </button>
        )}
      </div>

      {adding && (
        <div className="pop-in mt-8 w-[min(90vw,380px)] rounded-lg border border-white/15 bg-panel p-5">
          <p className="mb-3 text-sm font-semibold">Add a profile</p>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addProfile()}
            placeholder="Name"
            maxLength={16}
            className="mb-4 w-full rounded bg-black/50 px-3 py-2 text-sm outline-none ring-1 ring-white/15 focus:ring-2 focus:ring-white/50"
          />
          <div className="mb-5 flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className={`h-8 w-8 rounded-md ring-2 transition ${newColor === c ? "ring-white" : "ring-transparent"}`}
                style={{ backgroundColor: c }}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
          <div className="flex justify-end gap-2 text-sm">
            <button onClick={() => setAdding(false)} className="rounded px-4 py-1.5 text-neutral-300 hover:text-white">
              Cancel
            </button>
            <button onClick={addProfile} className="rounded bg-white px-4 py-1.5 font-semibold text-black hover:bg-neutral-300">
              Continue
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setManage((v) => !v)}
        className="mt-12 border border-neutral-500 px-6 py-2 text-[13px] font-semibold tracking-wide text-neutral-400 transition hover:border-white hover:text-white"
      >
        {manage ? "DONE" : "MANAGE PROFILES"}
      </button>
    </main>
  );
}
