import { BrowserRouter, Route, Routes } from 'react-router'
import { AuthProvider } from './context/AuthContext'
import { AppHeader, ProtectedRoute, RootRedirect } from './components/Chrome'
import { Login } from './pages/Login'
import { PassengerHome } from './pages/PassengerHome'

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/passenger"
            element={<ProtectedRoute role="PASSENGER"><PassengerHome /></ProtectedRoute>}
          />
          <Route
            path="/driver"
            element={<ProtectedRoute role="DRIVER"><PagePending sub="Driver console" title="Driver console" /></ProtectedRoute>}
          />
          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

// Stand-in until the real pages land; each later step swaps one out.
function PagePending({ sub, title }: { sub: string; title: string }) {
  return (
    <div className="grain min-h-dvh">
      <AppHeader sub={sub} />
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <p className="eyebrow">Signed in</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-ink">{title}</h1>
      </main>
    </div>
  )
}
