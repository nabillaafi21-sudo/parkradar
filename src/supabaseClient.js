import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Variables Supabase manquantes. Copie .env.example vers .env et renseigne tes clés.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
