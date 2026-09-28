import { BrowserRouter, Route, Routes } from 'react-router'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { ProtectedRoute, RootRedirect } from './components/Chrome'
import { Login } from './pages/Login'
import { PassengerHome } from './pages/PassengerHome'
import { DriverHome } from './pages/DriverHome'

export function App() {
  return (
    <ThemeProvider>
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
              element={<ProtectedRoute role="DRIVER"><DriverHome /></ProtectedRoute>}
            />
            <Route path="*" element={<RootRedirect />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}
