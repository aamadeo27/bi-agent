import { Routes, Route } from "react-router-dom";

function PlaceholderPage({ title }: { title: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white">
      <h1 className="text-2xl font-semibold text-primary">{title}</h1>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<PlaceholderPage title="BI Result Presenter" />} />
      {/* TODO: T1.4 — replace with the 11 real screens from ui-ux-spec.md */}
    </Routes>
  );
}
