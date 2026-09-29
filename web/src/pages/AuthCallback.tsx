import { Navigate } from 'react-router'
import { homeFor, useAuth } from '../context/AuthContext'
import { LoadingState } from '../components/States'

/**
 * Where Google/LinkedIn send the browser back to. supabase-js parses the
 * OAuth tokens out of the URL itself (its default detectSessionInUrl
 * behaviour) and fires onAuthStateChange in AuthContext — this page's only
 * job is to show something while that settles, then hand off to the same
 * routing every other authenticated landing uses.
 */
export function AuthCallback() {
  const { user, restoring } = useAuth()

  if (restoring) {
    return (
      <div className="grain grid min-h-dvh place-items-center">
        <LoadingState label="Finishing sign-in" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return <Navigate to={user.profileCompleted ? homeFor(user.role) : '/complete-profile'} replace />
}
