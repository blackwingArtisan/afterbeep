// Cloudflare Pages Function for every /api/* request. See ../../demo-api.ts.
import { handleDemoRequest, type DemoEnv } from '../../demo-api';

export const onRequest = ({ request, env }: { request: Request; env: DemoEnv }) => handleDemoRequest(request, env);
