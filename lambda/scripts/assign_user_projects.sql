-- Assign project access:
--   skscrmmanager1      -> every project
--   skscfleetmanager1   -> GOKL
--   sksctechnician1     -> GOKL
--
-- Safe to re-run: an assignment that already exists is skipped.
-- Users are matched on user_name, which the app sets from the Cognito
-- username on first sign-in (unless the Cognito account has a separate
-- "name" attribute). A user who has never signed in has no row yet and
-- is reported by the first check below.
--
--   mysql -h <DB_HOST> -u <DB_USER> -p <DB_NAME> < assign_user_projects.sql

-- ── Check: any of these usernames missing from the database? ───────
SELECT n.user_name AS missing_user
FROM (SELECT 'skscrmmanager1' AS user_name
      UNION ALL SELECT 'skscfleetmanager1'
      UNION ALL SELECT 'sksctechnician1') n
LEFT JOIN `USER` u ON u.user_name = n.user_name
WHERE u.user_id IS NULL;

-- ── RM manager: every project ─────────────────────────────────────
INSERT INTO USER_PROJECT (user_id, project_id)
SELECT u.user_id, p.project_id
FROM `USER` u
CROSS JOIN PROJECT p
WHERE u.user_name = 'skscrmmanager1'
  AND NOT EXISTS (SELECT 1 FROM USER_PROJECT up
                  WHERE up.user_id = u.user_id AND up.project_id = p.project_id);

-- ── Fleet manager and technician: GOKL ────────────────────────────
INSERT INTO USER_PROJECT (user_id, project_id)
SELECT u.user_id, 'GOKL'
FROM `USER` u
WHERE u.user_name IN ('skscfleetmanager1', 'sksctechnician1')
  AND NOT EXISTS (SELECT 1 FROM USER_PROJECT up
                  WHERE up.user_id = u.user_id AND up.project_id = 'GOKL');

-- ── Result ───────────────────────────────────────────────────────
SELECT u.user_name, u.user_role, GROUP_CONCAT(up.project_id ORDER BY up.project_id) AS projects
FROM `USER` u
LEFT JOIN USER_PROJECT up ON up.user_id = u.user_id
WHERE u.user_name IN ('skscrmmanager1', 'skscfleetmanager1', 'sksctechnician1')
GROUP BY u.user_id, u.user_name, u.user_role;
