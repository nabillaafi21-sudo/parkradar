-- ParkRadar — schéma de base de données Supabase
-- À copier-coller dans Supabase > SQL Editor > New query > Run

-- Active l'extension géographique (calculs de distance réels)
create extension if not exists postgis;

-- Table des profils (liée à l'auth Supabase)
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique,
  created_at timestamptz default now()
);

-- Table des parkings signalés par la communauté
create table parkings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('free', 'paid')),
  price text,
  lat double precision not null,
  lng double precision not null,
  location geography(Point, 4326) generated always as (
    ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
  ) stored,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz default now()
);

-- Index géographique pour des recherches "parkings proches" rapides
create index parkings_location_idx on parkings using gist (location);

-- Sécurité : chacun peut lire les parkings, seuls les utilisateurs connectés peuvent en ajouter
alter table parkings enable row level security;
alter table profiles enable row level security;

create policy "Tout le monde peut voir les parkings"
  on parkings for select
  using (true);

create policy "Les utilisateurs connectés peuvent ajouter un parking"
  on parkings for insert
  with check (auth.uid() is not null);

create policy "Chacun peut voir les profils"
  on profiles for select
  using (true);

create policy "Un utilisateur peut modifier son propre profil"
  on profiles for update
  using (auth.uid() = id);

-- Crée automatiquement un profil quand un utilisateur s'inscrit
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username)
  values (new.id, split_part(new.email, '@', 1));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Fonction de recherche : parkings dans un rayon donné (en mètres), triés par distance
create function parkings_nearby(user_lat double precision, user_lng double precision, radius_m int default 2000)
returns table (
  id uuid, name text, type text, price text,
  lat double precision, lng double precision,
  distance_m double precision
) as $$
  select p.id, p.name, p.type, p.price, p.lat, p.lng,
         ST_Distance(p.location, ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography) as distance_m
  from parkings p
  where ST_DWithin(p.location, ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography, radius_m)
  order by distance_m asc;
$$ language sql stable;
