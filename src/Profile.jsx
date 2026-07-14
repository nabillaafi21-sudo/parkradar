import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

export default function Profile({ session, onClose, onRadiusPreference }) {
  const [loading, setLoading] = useState(true)
  const [username, setUsername] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [defaultRadius, setDefaultRadius] = useState(3)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [pwSaving, setPwSaving] = useState(false)

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('profiles')
        .select('username, birth_date, avatar_url, default_radius_km')
        .eq('id', session.user.id)
        .single()
      if (!error && data) {
        setUsername(data.username || '')
        setBirthDate(data.birth_date || '')
        setAvatarUrl(data.avatar_url || '')
        setDefaultRadius(data.default_radius_km || 3)
      }
      setLoading(false)
    }
    load()
  }, [session.user.id])

  async function handlePhotoChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setSaveMsg('')
    const ext = file.name.split('.').pop()
    const path = `${session.user.id}/avatar.${ext}`
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true })
    if (uploadError) {
      setSaveMsg("Erreur lors de l'envoi de la photo : " + uploadError.message)
      setUploading(false)
      return
    }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    const urlWithCacheBust = data.publicUrl + '?t=' + Date.now()
    setAvatarUrl(urlWithCacheBust)
    await supabase.from('profiles').update({ avatar_url: urlWithCacheBust }).eq('id', session.user.id)
    setUploading(false)
  }

  async function saveProfile() {
    setSaving(true)
    setSaveMsg('')
    const { error } = await supabase
      .from('profiles')
      .update({
        username: username.trim() || null,
        birth_date: birthDate || null,
        default_radius_km: defaultRadius,
      })
      .eq('id', session.user.id)
    setSaving(false)
    if (error) {
      setSaveMsg('Erreur : ' + error.message)
    } else {
      setSaveMsg('Profil enregistré.')
      onRadiusPreference?.(defaultRadius)
    }
  }

  async function changePassword() {
    setPwMsg('')
    if (newPassword.length < 6) {
      setPwMsg('Le mot de passe doit faire au moins 6 caractères.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPwMsg('Les deux mots de passe ne correspondent pas.')
      return
    }
    setPwSaving(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setPwSaving(false)
    if (error) {
      setPwMsg('Erreur : ' + error.message)
    } else {
      setPwMsg('Mot de passe mis à jour.')
      setNewPassword('')
      setConfirmPassword('')
    }
  }

  return (
    <div className="profile-overlay">
      <div className="profile-screen">
        <div className="profile-header">
          <button className="back-btn" onClick={onClose}>
            ← Retour
          </button>
          <h2>Mon profil</h2>
        </div>

        {loading ? (
          <p className="profile-loading">Chargement…</p>
        ) : (
          <div className="profile-body">
            <div className="avatar-row">
              <div className="avatar-preview">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Photo de profil" />
                ) : (
                  <span>{session.user.email[0].toUpperCase()}</span>
                )}
              </div>
              <label className="avatar-upload-btn">
                {uploading ? 'Envoi…' : 'Changer la photo'}
                <input type="file" accept="image/*" onChange={handlePhotoChange} hidden disabled={uploading} />
              </label>
            </div>

            <div className="field">
              <label>Email</label>
              <input value={session.user.email} disabled />
            </div>

            <div className="field">
              <label>Nom d'utilisateur</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Ton pseudo" />
            </div>

            <div className="field">
              <label>Date de naissance</label>
              <input type="date" value={birthDate || ''} onChange={(e) => setBirthDate(e.target.value)} />
            </div>

            <div className="field">
              <label>
                Rayon de recherche par défaut <b>{defaultRadius} km</b>
              </label>
              <input
                type="range"
                min="0.5"
                max="10"
                step="0.5"
                value={defaultRadius}
                onChange={(e) => setDefaultRadius(parseFloat(e.target.value))}
              />
            </div>

            {saveMsg && <p className="profile-msg">{saveMsg}</p>}
            <button className="btn-save full" onClick={saveProfile} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer le profil'}
            </button>

            <div className="profile-divider"></div>

            <h3>Changer le mot de passe</h3>
            <div className="field">
              <label>Nouveau mot de passe</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="6 caractères min."
              />
            </div>
            <div className="field">
              <label>Confirmer le mot de passe</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Retape le mot de passe"
              />
            </div>
            {pwMsg && <p className="profile-msg">{pwMsg}</p>}
            <button className="btn-save full" onClick={changePassword} disabled={pwSaving}>
              {pwSaving ? 'Mise à jour…' : 'Changer le mot de passe'}
            </button>

            <div className="profile-divider"></div>

            <button className="btn-cancel full" onClick={() => supabase.auth.signOut()}>
              Se déconnecter
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
