import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from './supabaseClient'
import Auth from './Auth'
import './app.css'

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatDist(m) {
  if (m < 1000) return Math.round(m) + ' m'
  return (m / 1000).toFixed(1) + ' km'
}

export default function App() {
  const [session, setSession] = useState(null)
  const [checkingSession, setCheckingSession] = useState(true)
  const [status, setStatus] = useState('En attente de localisation…')
  const [statusErr, setStatusErr] = useState(false)
  const [locating, setLocating] = useState(false)
  const [located, setLocated] = useState(false)
  const [spots, setSpots] = useState([])
  const [userPos, setUserPos] = useState(null)
  const [radiusKm, setRadiusKm] = useState(3)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [formType, setFormType] = useState('free')
  const [formName, setFormName] = useState('')
  const [formPrice, setFormPrice] = useState('')
  const [addressQuery, setAddressQuery] = useState('')
  const [addressResults, setAddressResults] = useState([])
  const [addressSearching, setAddressSearching] = useState(false)

  const mapRef = useRef(null)
  const leafletMap = useRef(null)
  const userMarkerRef = useRef(null)
  const markersRef = useRef([])
  const pendingLatLng = useRef(null)
  const pendingMarkerRef = useRef(null)
  const addressDebounce = useRef(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setCheckingSession(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session || leafletMap.current) return
    const map = L.map(mapRef.current, { zoomControl: false }).setView([48.8566, 2.3522], 13)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap &copy; CARTO',
    }).addTo(map)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    map.on('click', (e) => {
      setPending(e.latlng)
      setSheetOpen(true)
    })
    leafletMap.current = map
  }, [session])


  function setPending(latlng) {
    pendingLatLng.current = latlng
    if (pendingMarkerRef.current) leafletMap.current.removeLayer(pendingMarkerRef.current)
    pendingMarkerRef.current = L.circleMarker(latlng, {
      radius: 9,
      color: '#f4c430',
      fillColor: '#f4c430',
      fillOpacity: 0.85,
      weight: 2,
    }).addTo(leafletMap.current)
  }

  function clearPending() {
    pendingLatLng.current = null
    if (pendingMarkerRef.current) {
      leafletMap.current.removeLayer(pendingMarkerRef.current)
      pendingMarkerRef.current = null
    }
  }

  function addMarker(spot) {
    const color = spot.type === 'free' ? '#4cc38a' : '#ef9d4e'
    const icon = L.divIcon({
      className: '',
      html: `<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);border:2px solid #16181c;display:flex;align-items:center;justify-content:center;"><span style="transform:rotate(45deg);color:#16181c;font-weight:700;font-size:11px;font-family:Oswald;">P</span></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 22],
    })
    const marker = L.marker([spot.lat, spot.lng], { icon }).addTo(leafletMap.current)
    const priceText = spot.price ? ` — ${spot.price}` : ''
    marker.bindPopup(`<b>${spot.name}</b><br>${spot.type === 'free' ? 'Gratuit' : 'Payant'}${priceText}`)
    markersRef.current.push(marker)
  }

  function clearMarkers() {
    markersRef.current.forEach((m) => leafletMap.current.removeLayer(m))
    markersRef.current = []
  }

  function locateOnce() {
    if (located || locating) return
    if (!navigator.geolocation) {
      setStatus("La géolocalisation n'est pas supportée par ce navigateur.")
      setStatusErr(true)
      return
    }
    setLocating(true)
    setStatus('Recherche de ta position GPS…')
    setStatusErr(false)

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const pt = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setUserPos(pt)
        leafletMap.current.setView([pt.lat, pt.lng], 16)
        if (userMarkerRef.current) leafletMap.current.removeLayer(userMarkerRef.current)
        userMarkerRef.current = L.circleMarker([pt.lat, pt.lng], {
          radius: 8,
          color: '#4a9eff',
          fillColor: '#4a9eff',
          fillOpacity: 0.9,
          weight: 2,
        })
          .addTo(leafletMap.current)
          .bindPopup('<b>Toi</b>')

        setLocating(false)
        setLocated(true)
        searchNearby(pt, radiusKm * 1000)
      },
      (err) => {
        setLocating(false)
        const messages = {
          1: 'Accès à la position refusé. Autorise la géolocalisation dans les réglages du navigateur.',
          2: 'Position indisponible. Vérifie ta connexion ou réessaie.',
          3: 'La demande de localisation a expiré. Réessaie.',
        }
        setStatus(messages[err.code] || 'Impossible de récupérer ta position.')
        setStatusErr(true)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    )
  }

  async function searchNearby(pt, radiusMeters) {
    clearMarkers()
    setStatus(`Recherche dans un rayon de ${(radiusMeters / 1000).toFixed(1)} km…`)
    setStatusErr(false)

    let dbSpots = []
    const { data, error } = await supabase.rpc('parkings_nearby', {
      user_lat: pt.lat,
      user_lng: pt.lng,
      radius_m: radiusMeters,
    })
    if (!error && data) {
      dbSpots = data.map((d) => ({ ...d, source: 'community', _dist: d.distance_m }))
    }

    let osmSpots = []
    try {
      const query = `[out:json][timeout:25];(
        node["amenity"="parking"](around:${radiusMeters},${pt.lat},${pt.lng});
        way["amenity"="parking"](around:${radiusMeters},${pt.lat},${pt.lng});
        node["amenity"="parking_space"](around:${radiusMeters},${pt.lat},${pt.lng});
        way["parking:lane:both"](around:${radiusMeters},${pt.lat},${pt.lng});
        way["parking:lane:left"](around:${radiusMeters},${pt.lat},${pt.lng});
        way["parking:lane:right"](around:${radiusMeters},${pt.lat},${pt.lng});
      );out center 80;`
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
      })
      if (res.ok) {
        const json = await res.json()
        osmSpots = json.elements
          .map((el) => {
            const lat = el.lat || el.center?.lat
            const lng = el.lon || el.center?.lng || el.center?.lon
            if (!lat || !lng) return null
            const tags = el.tags || {}
            const isLane = tags['parking:lane:both'] || tags['parking:lane:left'] || tags['parking:lane:right']
            const fee = tags.fee
            const type = isLane ? 'free' : fee === 'no' ? 'free' : fee === 'yes' ? 'paid' : 'free'
            return {
              id: 'osm_' + el.type + el.id,
              name: tags.name || (isLane ? 'Stationnement en rue' : 'Parking'),
              type,
              price: tags['fee:conditional'] || '',
              lat,
              lng,
              source: isLane ? 'osm_lane' : 'osm',
              _dist: haversine(pt.lat, pt.lng, lat, lng),
            }
          })
          .filter(Boolean)
      }
    } catch (e) {
      // on garde les résultats communautaires même si OSM échoue
    }

    const all = [...dbSpots, ...osmSpots].sort((a, b) => a._dist - b._dist)
    all.forEach(addMarker)
    setSpots(all)
    if (all.length === 0) {
      setStatus('Aucun emplacement trouvé dans ce rayon. Essaie un rayon plus large, ou signale-en un avec le bouton +.')
      setStatusErr(true)
    } else {
      setStatus(`${all.length} emplacement(s) trouvé(s) dans un rayon de ${(radiusMeters / 1000).toFixed(1)} km.`)
      setStatusErr(false)
    }
  }

  function rerunSearch() {
    if (!userPos) {
      setStatus('Active le GPS pour lancer une recherche.')
      setStatusErr(true)
      return
    }
    searchNearby(userPos, radiusKm * 1000)
  }

  function searchAddress(q) {
    setAddressQuery(q)
    if (addressDebounce.current) clearTimeout(addressDebounce.current)
    if (q.trim().length < 3) {
      setAddressResults([])
      return
    }
    addressDebounce.current = setTimeout(async () => {
      setAddressSearching(true)
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`
        )
        const json = await res.json()
        setAddressResults(json)
      } catch (e) {
        setAddressResults([])
      }
      setAddressSearching(false)
    }, 500)
  }

  function pickAddress(result) {
    const latlng = { lat: parseFloat(result.lat), lng: parseFloat(result.lon) }
    setPending(latlng)
    leafletMap.current.setView([latlng.lat, latlng.lng], 17)
    setAddressResults([])
    setAddressQuery(result.display_name)
  }

  function useMyPosition() {
    if (!userPos) {
      setStatus('Active le GPS pour utiliser ta position actuelle.')
      setStatusErr(true)
      return
    }
    setPending(userPos)
    setAddressQuery('')
    setAddressResults([])
  }

  async function saveParking() {
    const latlng = pendingLatLng.current
    if (!latlng) {
      setStatus("Choisis un emplacement : recherche une adresse, utilise ta position, ou touche la carte.")
      setStatusErr(true)
      return
    }
    const name = formName.trim() || 'Parking sans nom'
    const { error } = await supabase.from('parkings').insert({
      name,
      type: formType,
      price: formType === 'paid' ? formPrice.trim() : null,
      lat: latlng.lat,
      lng: latlng.lng,
      created_by: session.user.id,
    })
    if (error) {
      setStatus("Erreur lors de l'ajout : " + error.message)
      setStatusErr(true)
    } else {
      addMarker({ name, type: formType, price: formPrice, lat: latlng.lat, lng: latlng.lng })
      setSpots((prev) =>
        [
          ...prev,
          {
            name,
            type: formType,
            price: formPrice,
            lat: latlng.lat,
            lng: latlng.lng,
            source: 'community',
            _dist: userPos ? haversine(userPos.lat, userPos.lng, latlng.lat, latlng.lng) : 0,
          },
        ].sort((a, b) => a._dist - b._dist)
      )
    }
    closeSheet()
  }

  function closeSheet() {
    clearPending()
    setFormName('')
    setFormPrice('')
    setFormType('free')
    setAddressQuery('')
    setAddressResults([])
    setSheetOpen(false)
  }

  if (checkingSession) return null
  if (!session) return <Auth onAuthed={setSession} />

  return (
    <div id="app">
      <header>
        <div className="brand">
          <div className="brand-mark">P</div>
          <div className="brand-text">
            <h1>ParkRadar</h1>
            <p>Connecté en tant que {session.user.email}</p>
          </div>
          <button className="logout" onClick={() => supabase.auth.signOut()}>
            Déconnexion
          </button>
        </div>

        <div className="locate-bar">
          <button id="locateBtn" onClick={locateOnce} disabled={locating || located}>
            <span className={`radar ${locating ? 'spin' : ''}`}></span>
            <span>{locating ? 'Localisation…' : located ? 'Position détectée' : 'Activer le GPS'}</span>
          </button>
        </div>

        <div className="radius-control">
          <label>
            Rayon de recherche <b>{radiusKm} km</b>
          </label>
          <input
            type="range"
            min="0.5"
            max="10"
            step="0.5"
            value={radiusKm}
            onChange={(e) => setRadiusKm(parseFloat(e.target.value))}
          />
          <button className="search-btn" onClick={rerunSearch}>
            Rechercher
          </button>
        </div>

        <div className={`status ${statusErr ? 'err' : ''}`}>{status}</div>
      </header>

      <div className="map-wrap">
        <div ref={mapRef} id="map"></div>
        <div className="map-hint">Touche la carte pour signaler un parking</div>
      </div>

      <div className="legend">
        <span><i className="dot free"></i>Gratuit</span>
        <span><i className="dot paid"></i>Payant</span>
        <span><i className="dot you"></i>Toi</span>
      </div>

      <div id="list">
        {spots.length === 0 ? (
          <div className="empty">Active ta position pour voir les emplacements les plus proches.</div>
        ) : (
          spots.map((s) => (
            <div className="ticket" key={s.id || s.name + s.lat}>
              <div className="ticket-top">
                <div className={`p-badge ${s.type}`}>P</div>
                <div className="ticket-info">
                  <p className="name">{s.name}</p>
                  <div className="meta">
                    <span className={`tag ${s.type}`}>{s.type === 'free' ? 'Gratuit' : 'Payant'}</span>
                    {s.price && <span>{s.price}</span>}
                    {s.source === 'community' && <span>Communauté</span>}
                  </div>
                </div>
                <div className="dist">
                  {formatDist(s._dist)}
                  <small>{Math.max(1, Math.round(s._dist / 80))} min</small>
                </div>
              </div>
              <div className="ticket-torn"></div>
            </div>
          ))
        )}
      </div>

      <div className="fab" onClick={() => setSheetOpen(true)}>
        +
      </div>

      {sheetOpen && (
        <div className="sheet-overlay open" onClick={(e) => e.target === e.currentTarget && closeSheet()}>
          <div className="sheet">
            <h2>Signaler un parking</h2>
            <p className="hint">Recherche une adresse, utilise ta position, ou touche la carte.</p>

            <div className="field">
              <label>Adresse</label>
              <input
                value={addressQuery}
                onChange={(e) => searchAddress(e.target.value)}
                placeholder="Ex. Rue de la Paix, Roosendaal"
              />
              {addressSearching && <p className="addr-hint">Recherche…</p>}
              {addressResults.length > 0 && (
                <ul className="addr-list">
                  {addressResults.map((r) => (
                    <li key={r.place_id}>
                      <button type="button" onClick={() => pickAddress(r)}>
                        {r.display_name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" className="use-pos-btn" onClick={useMyPosition}>
                Utiliser ma position actuelle
              </button>
            </div>

            <div className="field">
              <label>Nom / rue</label>
              <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Ex. Parking Rue de la Paix" />
            </div>
            <div className="field">
              <label>Type</label>
              <div className="type-toggle">
                <button type="button" className={formType === 'free' ? 'active free' : ''} onClick={() => setFormType('free')}>
                  Gratuit
                </button>
                <button type="button" className={formType === 'paid' ? 'active paid' : ''} onClick={() => setFormType('paid')}>
                  Payant
                </button>
              </div>
            </div>
            {formType === 'paid' && (
              <div className="field">
                <label>Tarif</label>
                <input value={formPrice} onChange={(e) => setFormPrice(e.target.value)} placeholder="Ex. 2€/h" />
              </div>
            )}
            <div className="sheet-actions">
              <button className="btn-cancel" onClick={closeSheet}>
                Annuler
              </button>
              <button className="btn-save" onClick={saveParking}>
                Ajouter
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
