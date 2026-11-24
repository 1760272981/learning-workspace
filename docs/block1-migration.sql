-- Learning Workspace 第一块迁移草稿（2026-11-24，授权范围经负责人拍板更新）
-- 只供主会话审查后创建迁移计划；本文件未执行。
-- legacy 适配器固定用匿名身份，故四表给匿名 select+insert+update+delete；
-- 正常入口由函数 LW_WRITE_KEY 闸门保护，残余风险（绕过函数直连库）已记录并经负责人确认。
-- 平台受限子集：app schema、指定基础类型、PRIMARY KEY / UNIQUE / NOT NULL，无 CHECK。

CREATE TABLE app.lw_concepts (
  id uuid PRIMARY KEY,
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
  project_id text NOT NULL,
  concept_id uuid NOT NULL,
  status text NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (project_id, concept_id)
);

-- accessPolicies JSON（负责人 2026-11-24 拍板：四表匿名读+写；lw_probe 不在本次触碰范围，保持 deny）：
-- [
--   { "table": "lw_concepts", "principal": "anonymous", "actions": ["select", "insert", "update", "delete"], "template": "public" },
--   { "table": "lw_applications", "principal": "anonymous", "actions": ["select", "insert", "update", "delete"], "template": "public" },
--   { "table": "lw_verifications", "principal": "anonymous", "actions": ["select", "insert", "update", "delete"], "template": "public" },
--   { "table": "lw_marks", "principal": "anonymous", "actions": ["select", "insert", "update", "delete"], "template": "public" }
-- ]
