import { BrowserRouter, Route, Routes } from 'react-router'
import { AuthProvider } from './context/AuthContext'
import { AppHeader, ProtectedRoute, RootRedirect } from './components/Chrome'
import { Logo } from './components/Logo'

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPending />} />
          <Route
            path="/passenger"
            element={<ProtectedRoute role="PASSENGER"><PagePending sub="Passenger" title="Passenger home" /></ProtectedRoute>}
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

// Stand-ins until the real pages land; each later step swaps one out.
function LoginPending() {
  return (
    <main className="grain grid min-h-dvh place-items-center px-6">
      <div className="text-center">
        <div className="flex justify-center"><Logo size="md" /></div>
        <p className="eyebrow mt-6">Sign-in screen coming next</p>
      </div>
    </main>
  )
}

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
