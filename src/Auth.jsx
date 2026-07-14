import { useState } from 'react'
import { supabase } from './supabaseClient'

export default function Auth({ onAuthed }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const action =
      mode === 'login'
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password })
    const { data, error } = await action
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    if (mode === 'signup' && !data.session) {
      setError('Compte créé — vérifie ta boîte mail pour confirmer, puis connecte-toi.')
      return
    }
    onAuthed(data.session)
  }

  return (
    <div className="auth-screen">
      <div className="auth-mark">P</div>
      <h1>ParkRadar</h1>
      <p className="auth-sub">
        {mode === 'login' ? 'Connecte-toi pour continuer' : 'Crée ton compte'}
      </p>
      <form onSubmit={handleSubmit} className="auth-form">
        <input
          type="email"
          placeholder="Adresse email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Mot de passe (6 caractères min.)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          required
        />
        {error && <p className="auth-error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Un instant…' : mode === 'login' ? 'Se connecter' : "S'inscrire"}
        </button>
      </form>
      <button
        className="auth-switch"
        onClick={() => {
          setError('')
          setMode(mode === 'login' ? 'signup' : 'login')
        }}
      >
        {mode === 'login'
          ? "Pas de compte ? S'inscrire"
          : 'Déjà un compte ? Se connecter'}
      </button>
    </div>
  )
}
