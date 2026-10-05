-- Field records (Field notes phase 2): visits, items (points, tracks, photos) per team project, partner access by
-- email per project, and a private photo bucket. TSA3 members (hydro_members) see everything; a partner sees only the
-- projects they were added to. Everyone who can see a project can add records to it; records can be edited or deleted
-- by their author or by any member. Photos live at hydro-field/<project_id>/<item_id>.jpg (+ _thumb.jpg).

create table if not exists public.hydro_project_partners (
  project_id uuid not null references public.hydro_projects(id) on delete cascade,
  email text not null check (email = lower(email)),
  added_by text,
  added_at timestamptz not null default now(),
  primary key (project_id, email)
);

create or replace function public.hydro_can_see_project(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select pid is not null and (public.is_hydro_member() or exists (
    select 1 from public.hydro_project_partners p
    where p.project_id = pid and p.email = lower(coalesce(auth.jwt() ->> 'email', ''))));
$$;

-- first path segment of a storage object name as a project id (null when it is not a uuid, so other buckets never error)
create or replace function public.hydro_path_project(objname text)
returns uuid language sql immutable set search_path = public as $$
  select case when split_part(objname, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(objname, '/', 1)::uuid end;
$$;

create table if not exists public.hydro_field_visits (
  id uuid primary key,                                   -- generated on the phone, so offline records sync without duplicates
  project_id uuid not null references public.hydro_projects(id) on delete cascade,
  visit_date date not null,
  title text,
  note text,
  created_by text, updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hydro_field_visits_project on public.hydro_field_visits (project_id, visit_date);

create table if not exists public.hydro_field_items (
  id uuid primary key,
  project_id uuid not null references public.hydro_projects(id) on delete cascade,
  visit_id uuid references public.hydro_field_visits(id) on delete set null,
  kind text not null check (kind in ('point', 'track', 'photo')),
  name text,
  note text,
  lon double precision, lat double precision,
  acc double precision, alt double precision, dir double precision,
  taken_at timestamptz,
  geom jsonb,                                            -- track segments: [[[lon, lat, t, acc, alt], ...], ...]
  photo_file text, photo_path text, thumb_path text,
  created_by text, updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hydro_field_items_project on public.hydro_field_items (project_id);
create index if not exists hydro_field_items_visit on public.hydro_field_items (visit_id);

drop trigger if exists hydro_field_visits_touch on public.hydro_field_visits;
create trigger hydro_field_visits_touch before insert or update on public.hydro_field_visits for each row execute function public.hydro_touch_updated_at();
drop trigger if exists hydro_field_items_touch on public.hydro_field_items;
create trigger hydro_field_items_touch before insert or update on public.hydro_field_items for each row execute function public.hydro_touch_updated_at();

alter table public.hydro_project_partners enable row level security;
alter table public.hydro_field_visits enable row level security;
alter table public.hydro_field_items enable row level security;

-- partners: visible to anyone who can see the project; managed by members
create policy hydro_partners_select on public.hydro_project_partners for select to authenticated using (public.hydro_can_see_project(project_id));
create policy hydro_partners_insert on public.hydro_project_partners for insert to authenticated with check (public.is_hydro_member());
create policy hydro_partners_delete on public.hydro_project_partners for delete to authenticated using (public.is_hydro_member());

-- partners can read the projects they were added to (members already read all)
create policy hydro_projects_partner_select on public.hydro_projects for select to authenticated using (public.hydro_can_see_project(id));

create policy hydro_visits_select on public.hydro_field_visits for select to authenticated using (public.hydro_can_see_project(project_id));
create policy hydro_visits_insert on public.hydro_field_visits for insert to authenticated with check (public.hydro_can_see_project(project_id));
create policy hydro_visits_update on public.hydro_field_visits for update to authenticated
  using (public.is_hydro_member() or created_by = (auth.jwt() ->> 'email')) with check (public.hydro_can_see_project(project_id));
create policy hydro_visits_delete on public.hydro_field_visits for delete to authenticated using (public.is_hydro_member() or created_by = (auth.jwt() ->> 'email'));

create policy hydro_items_select on public.hydro_field_items for select to authenticated using (public.hydro_can_see_project(project_id));
create policy hydro_items_insert on public.hydro_field_items for insert to authenticated with check (public.hydro_can_see_project(project_id));
create policy hydro_items_update on public.hydro_field_items for update to authenticated
  using (public.is_hydro_member() or created_by = (auth.jwt() ->> 'email')) with check (public.hydro_can_see_project(project_id));
create policy hydro_items_delete on public.hydro_field_items for delete to authenticated using (public.is_hydro_member() or created_by = (auth.jwt() ->> 'email'));

-- private photo bucket (resized JPEGs, ~0.4 MB; originals stay on the team drive)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hydro-field', 'hydro-field', false, 10485760, array['image/jpeg'])
on conflict (id) do nothing;

create policy hydro_field_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'hydro-field' and public.hydro_can_see_project(public.hydro_path_project(name)));
create policy hydro_field_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'hydro-field' and public.hydro_can_see_project(public.hydro_path_project(name)));
create policy hydro_field_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'hydro-field' and (public.is_hydro_member() or owner = auth.uid()));
create policy hydro_field_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'hydro-field' and (public.is_hydro_member() or owner = auth.uid()));

-- signed-out visitors never need the visibility check
revoke execute on function public.hydro_can_see_project(uuid) from public, anon;
grant execute on function public.hydro_can_see_project(uuid) to authenticated;
