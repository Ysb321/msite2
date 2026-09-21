import { useEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import SWRProvider from "./components/SWRProvider";
import ServiceWorker from "./components/ServiceWorker";
import RouteProgress from "./components/RouteProgress";
import { MyListProvider } from "./context/MyListContext";
import { ExploreAllProvider } from "./context/ExploreAllContext";
import { TitleModalProvider } from "./context/TitleModalContext";
import { KeyboardShortcutsProvider } from "./context/KeyboardShortcutsContext";

import ProfileGatePage from "./pages/ProfileGatePage";
import HomePage from "./pages/HomePage";
import MoviesPage from "./pages/MoviesPage";
import TvPage from "./pages/TvPage";
import AnimePage from "./pages/AnimePage";
import CategoriesPage from "./pages/CategoriesPage";
import GenrePage from "./pages/GenrePage";
import MyListPage from "./pages/MyListPage";
import SearchPage from "./pages/SearchPage";
import TitlePage from "./pages/TitlePage";
import WatchPage from "./pages/WatchPage";
import PersonPage from "./pages/PersonPage";

function ScrollToTop() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location.pathname, location.search]);

  return <RouteProgress key={location.pathname + location.search} />;
}

export default function App() {
  return (
    <SWRProvider>
      <BrowserRouter>
        <MyListProvider>
          <ExploreAllProvider>
            <TitleModalProvider>
              <KeyboardShortcutsProvider>
                <ScrollToTop />
                <ServiceWorker />
                <Routes>
                  <Route path="/" element={<ProfileGatePage />} />
                  <Route path="/home" element={<HomePage />} />
                  <Route path="/movies" element={<MoviesPage />} />
                  <Route path="/tv" element={<TvPage />} />
                  <Route path="/anime" element={<AnimePage />} />
                  <Route path="/categories" element={<CategoriesPage />} />
                  <Route path="/genres/:type/:id" element={<GenrePage />} />
                  <Route path="/my-list" element={<MyListPage />} />
                  <Route path="/search" element={<SearchPage />} />
                  <Route path="/title/:type/:id" element={<TitlePage />} />
                  <Route path="/watch/:type/:id" element={<WatchPage />} />
                  <Route path="/person/:id" element={<PersonPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </KeyboardShortcutsProvider>
            </TitleModalProvider>
          </ExploreAllProvider>
        </MyListProvider>
      </BrowserRouter>
    </SWRProvider>
  );
}
