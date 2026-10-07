-- Purpose: LOCAL development seed (runs after migrations on `npm run db:reset`). Fictional data only:
-- four sign-in users (one per role, password `password123`, local use only) and two fictional
-- profiles with two versions each. Never put real people or employees here. Not for cloud projects.
--
-- Users:    member@ / checker@ / manager@ / admin@example.test
-- Profiles: "Alex Sample" (internal, owned by the member) and "Riley Example" (external, owned by the admin,
--           so the member has a profile of "another user" to be denied in the RLS tests).
-- Everything runs in one transaction: if anything fails, nothing (including the domain exception below)
-- is left behind.
begin;

-- The sign-up domain check only lets @example.test through while this setting is on; switch it off at the end.
update public.app_settings set value = 'on' where key = 'allow_example_test';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  jsonb_build_object('full_name', u.full_name), now(), now(),
  '', '', '', ''
from (values
  ('00000000-0000-0000-0000-000000000101'::uuid, 'member@example.test',  'Test Member'),
  ('00000000-0000-0000-0000-000000000102'::uuid, 'checker@example.test', 'Test Checker'),
  ('00000000-0000-0000-0000-000000000103'::uuid, 'manager@example.test', 'Test Manager'),
  ('00000000-0000-0000-0000-000000000104'::uuid, 'admin@example.test',   'Test Admin')
) as u(id, email, full_name);

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.email like '%@example.test';

update public.app_settings set value = 'off' where key = 'allow_example_test';

-- app_users rows were created by the auth trigger; promote everyone except the default team_member.
update public.app_users set role = 'checker' where email = 'checker@example.test';
update public.app_users set role = 'manager' where email = 'manager@example.test';
update public.app_users set role = 'admin'   where email = 'admin@example.test';

-- Profiles are saved through the real save function, acting as their owner (the function is security invoker
-- and reads auth.uid() from the JWT claims).
do $$
declare
  v1 uuid;
  v1_profile uuid;
begin
  -- Alex Sample: internal, owner = member. v1 Base, then v2 role-specific (parent = v1).
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000101","role":"authenticated"}', true);

  select s.new_version_id into v1 from public.save_profile_version(
    null, 'internal', 'base', 'Base', null, 'scratch',
    $json${
      "name": "Alex Sample",
      "jobTitle": "Senior Software Engineer",
      "experienceSummary": "8+ Years of Industry Experience",
      "specialization": "Backend Platforms",
      "overview": "Fictional engineer used for local development.\nBuilds data-heavy backend services and mentors junior developers.",
      "education": [{"year": "2014", "qualification": "B.E. (Computer Science), Riverside University"}],
      "projects": [
        {
          "duration": "Jan 2022 - Present",
          "title": "Orders Analytics",
          "toolsAndTechnologies": ["Python", "FastAPI", "PostgreSQL"],
          "teamSize": "5-6",
          "role": "Backend Developer",
          "projectLink": "",
          "description": "Analytics platform that lets teams track orders and share dashboards.",
          "responsibilities": ["Designed the reporting API", "Reduced query time with indexing"]
        }
      ],
      "skills": [{"name": "Python", "rating": "4.5"}, {"name": "SQL", "rating": "4"}],
      "certifications": ["Fictional Cloud Practitioner"],
      "tools": ["Git", "Docker"],
      "managerialExperience": [],
      "domains": ["Retail"],
      "languages": ["English", "Hindi"]
    }$json$::jsonb,
    '[]'::jsonb, null, null
  ) s;

  select p.profile_id into v1_profile from public.profile_versions p where p.id = v1;

  perform public.save_profile_version(
    v1_profile, 'internal', 'role_specific', 'Java Backend', v1, 'edit',
    $json${
      "name": "Alex Sample",
      "jobTitle": "Senior Software Engineer",
      "experienceSummary": "8+ Years of Industry Experience",
      "specialization": "Java Backend Services",
      "overview": "Fictional engineer used for local development.\nTailored for Java backend roles.",
      "education": [{"year": "2014", "qualification": "B.E. (Computer Science), Riverside University"}],
      "projects": [
        {
          "duration": "Jan 2022 - Present",
          "title": "Orders Analytics",
          "toolsAndTechnologies": ["Java", "Spring Boot", "PostgreSQL"],
          "teamSize": "5-6",
          "role": "Backend Developer",
          "projectLink": "",
          "description": "Analytics platform that lets teams track orders and share dashboards.",
          "responsibilities": ["Designed the reporting API", "Reduced query time with indexing", "Led code reviews"]
        }
      ],
      "skills": [{"name": "Java", "rating": "4"}, {"name": "SQL", "rating": "4"}],
      "certifications": ["Fictional Cloud Practitioner"],
      "tools": ["Git", "Docker", "Maven"],
      "managerialExperience": ["Mentored two junior developers"],
      "domains": ["Retail"],
      "languages": ["English", "Hindi"]
    }$json$::jsonb,
    '[{"path": "skills.0.rating", "reason": "rating inferred, please confirm"}]'::jsonb, null, null
  );

  -- Riley Example: external, owner = admin. v1 Base, then v2 edit.
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000104","role":"authenticated"}', true);

  select s.new_version_id into v1 from public.save_profile_version(
    null, 'external', 'base', 'Base', null, 'upload',
    $json${
      "name": "Riley Example",
      "jobTitle": "Data Engineer",
      "experienceSummary": "5+ Years of Industry Experience",
      "specialization": "Data Platforms",
      "overview": "Fictional candidate used for local development.",
      "education": [{"year": "2018", "qualification": "B.Tech (Information Technology), Lakeside Institute"}],
      "skills": ["SQL", "Python", "Data Modelling"],
      "tools": ["Airflow", "Git"],
      "certifications": ["Fictional Data Associate"],
      "projects": [
        {
          "duration": "Mar 2021 - Dec 2023",
          "client": "Northwind Retail, UK",
          "teamSize": "2-3",
          "role": "Data Engineer",
          "description": "Built nightly pipelines for a retail client.",
          "responsibilities": ["Built ingestion pipelines", "Monitored data quality"]
        }
      ],
      "experience": [
        {"company": "Contoso Software", "position": "Data Engineer", "duration": "2020 - Present", "highlights": ["Owned the warehouse model", "Cut pipeline cost"]}
      ]
    }$json$::jsonb,
    '[]'::jsonb, null, null
  ) s;

  select p.profile_id into v1_profile from public.profile_versions p where p.id = v1;

  perform public.save_profile_version(
    v1_profile, 'external', 'base', 'Base (reviewed)', v1, 'edit',
    $json${
      "name": "Riley Example",
      "jobTitle": "Senior Data Engineer",
      "experienceSummary": "5+ Years of Industry Experience",
      "specialization": "Data Platforms",
      "overview": "Fictional candidate used for local development.\nReviewed and updated.",
      "education": [{"year": "2018", "qualification": "B.Tech (Information Technology), Lakeside Institute"}],
      "skills": ["SQL", "Python", "Data Modelling", "dbt"],
      "tools": ["Airflow", "Git"],
      "certifications": ["Fictional Data Associate"],
      "projects": [
        {
          "duration": "Mar 2021 - Dec 2023",
          "client": "Northwind Retail, UK",
          "teamSize": "2-3",
          "role": "Data Engineer",
          "description": "Built nightly pipelines for a retail client.",
          "responsibilities": ["Built ingestion pipelines", "Monitored data quality"]
        }
      ],
      "experience": [
        {"company": "Contoso Software", "position": "Senior Data Engineer", "duration": "2020 - Present", "highlights": ["Owned the warehouse model", "Cut pipeline cost"]}
      ]
    }$json$::jsonb,
    '[]'::jsonb, null, null
  );

end $$;

commit;
