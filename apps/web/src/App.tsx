import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import Layout from "./components/Layout";
import LoadingSpinner from "./components/LoadingSpinner";
import Home from "./pages/Home";
import Ranking from "./pages/Ranking";
import History from "./pages/History";
import Stats from "./pages/Stats";
import Profile from "./pages/Profile";

function AuthGate() {
  const { loading, error, retry } = useAuth();

  if (loading) {
    return <LoadingSpinner message="認証中..." />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-8 gap-4">
        <div className="text-4xl mb-2">⚠️</div>
        <h1 className="text-lg font-bold text-gray-800">認証エラー</h1>
        <p className="text-sm text-gray-500 text-center">{error}</p>
        <button onClick={retry} className="btn-primary mt-2">
          再試行
        </button>
      </div>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/ranking" element={<Ranking />} />
        <Route path="/history" element={<History />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/profile" element={<Profile />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </BrowserRouter>
  );
}
