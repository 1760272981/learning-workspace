import { createDatabaseClient, createSiteContext, errorResponse } from './_qoder/backend.mjs';
import { createApplication } from './routes.mjs';

// 实验室允许的非 secret 固定来源常量；APP_ORIGIN 环境配置优先。
const PUBLIC_ORIGIN = 'https://learning-workspace-multi-v5d3qx7uw3a.qoder.zone';

const handle = createApplication({
  db: createDatabaseClient(),
  origin: () => Deno.env.get('APP_ORIGIN') || PUBLIC_ORIGIN,
});

Deno.serve(async (request) => {
  let context;
  try {
    context = createSiteContext(request, { forwardApplicationCredentials: true });
    return await handle(context);
  } catch (error) {
    return errorResponse(error, context?.requestId);
  }
});
