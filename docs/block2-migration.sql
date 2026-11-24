-- Learning Workspace 块2多用户迁移草稿（2026-11-24）
-- 只供主会话审查后创建迁移计划；本文件未执行。
-- function_backend 使用平台固定私有策略，accessPolicies 传 []。
-- 受限子集：app schema、uuid/text/integer/timestamptz/jsonb、PRIMARY KEY/UNIQUE/NOT NULL。
-- 约束仅使用主键、唯一与非空；不加默认值、索引、种子数据或权限语句。

CREATE TABLE app.lw_users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  password_iterations integer NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE app.lw_sessions (
  token_digest text PRIMARY KEY,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE app.lw_auth_limiter (
  key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL
);

CREATE TABLE app.lw_tokens (
  token_digest text PRIMARY KEY,
  user_id uuid NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE app.lw_concepts (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  project_id text NOT NULL,
  title text NOT NULL,
  kind text NOT NULL,
  branch text NOT NULL,
  created_at timestamptz NOT NULL,
  version integer NOT NULL
);

CREATE TABLE app.lw_applications (
  id uuid PRIMARY KEY,
  concept_id uuid NOT NULL,
  output_ref text NOT NULL,
  judging text NOT NULL,
  evidence text NOT NULL,
  consequence text NOT NULL,
  verify_action text NOT NULL,
  sources jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  UNIQUE (concept_id, output_ref)
);

CREATE TABLE app.lw_verifications (
  id uuid PRIMARY KEY,
  concept_id uuid NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE app.lw_marks (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  project_id text NOT NULL,
  concept_id uuid NOT NULL,
  status text NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (project_id, concept_id)
);

-- create_database_migration 参数：
-- accessPolicies: []
-- 权限由平台固定私有策略处理；归属由函数查询谓词强制。
