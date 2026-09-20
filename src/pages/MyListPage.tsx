"use client";

import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Card from "@/components/Card";
import { getList, onListChange, type ListItem } from "@/lib/storage";

export default function MyListPage() {
  const [items, setItems] = useState<ListItem[] | null>(null);

  useEffect(() => {
    setItems(getList());
    return onListChange(setItems);
  }, []);

  return (
    <main className="min-h-screen bg-ink">
      <Navbar />
      <div className="px-[4vw] pb-10 pt-24 md:pt-28">
        <h1 className="mb-6 text-2xl font-bold md:text-3xl">My List</h1>
        {items === null ? (
          <div className="grid grid-cols-3 gap-x-2.5 gap-y-14 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="skeleton aspect-[2/3]" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-72 flex-col items-center justify-center gap-3 text-neutral-400">
            <p className="text-lg">Your list is empty</p>
            <p className="text-sm">Hover a title and tap ＋ to save it here.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-x-2.5 gap-y-14 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
            {items.map((l) => (
              <Card key={l.id} item={{ ...l, media_type: l.type } as any} variant="poster" className="w-full" />
            ))}
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}
