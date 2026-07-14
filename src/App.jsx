import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from './supabaseClient'
import Auth from './Auth'
import Profile from './Profile'
import './app.css'

const TOMTOM_KEY = import.meta.env.VITE_TOMTOM_API_KEY

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
  const [profileOpen, setProfileOpen] = useState(false)
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
  const confirmingSpotId = useRef(null)
  const addressDebounce = useRef(null)
  const radiusCircleRef = useRef(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setCheckingSession(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    supabase
      .from('profiles')
      .select('default_radius_km')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        if (data?.default_radius_km) setRadiusKm(data.default_radius_km)
      })
  }, [session])

  useEffect(() => {
    if (!session || leafletMap.current) return
    const map = L.map(mapRef.current, { zoomControl: false }).setView([48.8566, 2.3522], 13)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap &copy; CARTO',
    }).addTo(map)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
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
    const color = spot.type === 'free' ? '#4cc38a' : spot.type === 'paid' ? '#ef9d4e' : '#a7a49b'
    const icon = L.divIcon({
      className: '',
      html: `<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);border:2px solid #16181c;display:flex;align-items:center;justify-content:center;"><span style="transform:rotate(45deg);color:#16181c;font-weight:700;font-size:11px;font-family:Oswald;">P</span></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 22],
    })
    const marker = L.marker([spot.lat, spot.lng], { icon }).addTo(leafletMap.current)
    const priceText = spot.price ? ` — ${spot.price}` : ''
    const typeLabel = spot.type === 'free' ? 'Gratuit' : spot.type === 'paid' ? 'Payant' : 'Type non précisé'
    marker.bindPopup(`<b>${spot.name}</b><br>${typeLabel}${priceText}`)
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
    let osmFailed = false
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
        headers: { 'Content-Type': 'text/plain' },
        body: query,
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
            const type = isLane ? 'free' : fee === 'no' ? 'free' : fee === 'yes' ? 'paid' : 'unknown'
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
      } else {
        osmFailed = true
      }
    } catch (e) {
      osmFailed = true
    }

    let tomtomSpots = []
    if (TOMTOM_KEY) {
      try {
        const ttRes = await fetch(
          `https://api.tomtom.com/search/2/nearbySearch/.json?key=${encodeURIComponent(TOMTOM_KEY)}&lat=${pt.lat}&lon=${pt.lng}&radius=${radiusMeters}&categorySet=7369&limit=100`
        )
        if (ttRes.ok) {
          const ttJson = await ttRes.json()
          tomtomSpots = (ttJson.results || [])
            .map((r) => {
              const lat = r.position?.lat
              const lng = r.position?.lon
              if (!lat || !lng) return null
              const alreadyKnown = osmSpots.some((s) => haversine(s.lat, s.lng, lat, lng) < 40)
              if (alreadyKnown) return null
              return {
                id: 'tomtom_' + r.id,
                name: r.poi?.name || 'Parking',
                type: 'unknown',
                price: '',
                lat,
                lng,
                source: 'tomtom',
                _dist: haversine(pt.lat, pt.lng, lat, lng),
              }
            })
            .filter(Boolean)
        }
      } catch (e) {
        // on garde les autres résultats même si TomTom échoue
      }
    }

    const all = [...dbSpots, ...osmSpots, ...tomtomSpots].sort((a, b) => a._dist - b._dist)
    all.forEach(addMarker)
    setSpots(all)
    if (all.length === 0 && osmFailed) {
      setStatus('La recherche OpenStreetMap a échoué (problème réseau). Réessaie dans un instant.')
      setStatusErr(true)
    } else if (all.length === 0) {
      setStatus('Aucun emplacement trouvé dans ce rayon. Essaie un rayon plus large, ou signale-en un avec le bouton +.')
      setStatusErr(true)
    } else {
      setStatus(`${all.length} emplacement(s) trouvé(s) dans un rayon de ${(radiusMeters / 1000).toFixed(1)} km.`)
      setStatusErr(false)
    }
  }

  useEffect(() => {
    if (!leafletMap.current || !userPos) return
    if (radiusCircleRef.current) leafletMap.current.removeLayer(radiusCircleRef.current)
    radiusCircleRef.current = L.circle([userPos.lat, userPos.lng], {
      radius: radiusKm * 1000,
      color: '#f4c430',
      weight: 1.5,
      fillColor: '#f4c430',
      fillOpacity: 0.06,
    }).addTo(leafletMap.current)
  }, [radiusKm, userPos])

  function recenter() {
    if (!userPos || !leafletMap.current) {
      setStatus('Active le GPS pour pouvoir te recentrer.')
      setStatusErr(true)
      return
    }
    leafletMap.current.setView([userPos.lat, userPos.lng], 16)
  }

  function focusSpot(spot) {
    if (!leafletMap.current) return
    leafletMap.current.setView([spot.lat, spot.lng], 17)
    const marker = markersRef.current.find(
      (m) => Math.abs(m.getLatLng().lat - spot.lat) < 0.00001 && Math.abs(m.getLatLng().lng - spot.lng) < 0.00001
    )
    if (marker) marker.openPopup()
  }

  function directionsUrl(spot) {
    return `https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lng}&travelmode=walking`
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

  async function useMyPosition() {
    if (!userPos) {
      setStatus('Active le GPS pour utiliser ta position actuelle.')
      setStatusErr(true)
      return
    }
    setPending(userPos)
    setAddressResults([])
    setAddressQuery('Recherche de ton adresse…')
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${userPos.lat}&lon=${userPos.lng}`
      )
      const json = await res.json()
      const addr = json.address || {}
      const road = addr.road || addr.pedestrian || addr.footway || ''
      const houseNumber = addr.house_number || ''
      const city = addr.city || addr.town || addr.village || ''
      const composedName = [road, houseNumber].filter(Boolean).join(' ')
      setAddressQuery(json.display_name || '')
      setFormName(composedName || city || 'Parking sans nom')
    } catch (e) {
      setAddressQuery('')
    }
  }

  function confirmSpot(spot) {
    confirmingSpotId.current = spot.id
    setPending({ lat: spot.lat, lng: spot.lng })
    setFormName(spot.name === 'Parking' || spot.name === 'Stationnement en rue' ? '' : spot.name)
    setFormType('free')
    setSheetOpen(true)
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
          <button className="logout" onClick={() => setProfileOpen(true)}>
            Profil
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
        <button className="recenter-btn" onClick={recenter} aria-label="Recentrer sur ma position">
          <span className="recenter-dot"></span>
        </button>
      </div>

      <div className="legend">
        <span><i className="dot free"></i>Gratuit</span>
        <span><i className="dot paid"></i>Payant</span>
        <span><i className="dot unknown"></i>Non précisé</span>
        <span><i className="dot you"></i>Toi</span>
      </div>

      <div id="list">
        {spots.length === 0 ? (
          <div className="empty">Active ta position pour voir les emplacements les plus proches.</div>
        ) : (
          spots.map((s) => (
            <div className="ticket" key={s.id || s.name + s.lat}>
              <div className="ticket-top" onClick={() => focusSpot(s)}>
                <div className={`p-badge ${s.type}`}>P</div>
                <div className="ticket-info">
                  <p className="name">{s.name}</p>
                  <div className="meta">
                    <span className={`tag ${s.type}`}>
                      {s.type === 'free' ? 'Gratuit' : s.type === 'paid' ? 'Payant' : 'Type non précisé'}
                    </span>
                    {s.price && <span>{s.price}</span>}
                    {s.source === 'community' && <span>Communauté</span>}
                    {s.source === 'tomtom' && <span>TomTom</span>}
                  </div>
                </div>
                <div className="dist">
                  {formatDist(s._dist)}
                  <small>{Math.max(1, Math.round(s._dist / 80))} min</small>
                </div>
              </div>
              <a
                className="directions-btn"
                href={directionsUrl(s)}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                Itinéraire
              </a>
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
            <p className="hint">Recherche une adresse ou utilise ta position actuelle.</p>

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

      {profileOpen && (
        <Profile
          session={session}
          onClose={() => setProfileOpen(false)}
          onRadiusPreference={(km) => setRadiusKm(km)}
        />
      )}
    </div>
  )
}