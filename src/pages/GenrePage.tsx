"use client";

import { useParams } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import BrowseGrid from "@/components/BrowseGrid";
import { MOVIE_GENRES, TV_GENRES } from "@/lib/rows";

export default function GenrePage() {
  const { type, id } = useParams<{ type: string; id: string }>();
  const t = type === "tv" ? "tv" : "movie";
  const name = (t === "tv" ? TV_GENRES : MOVIE_GENRES)[Number(id)] ?? "Genre";

  return (
    <main className="min-h-screen bg-ink">
      <Navbar />
      <BrowseGrid options={{ type: t, genre: Number(id), heading: name }} />
      <Footer />
    </main>
  );
}
