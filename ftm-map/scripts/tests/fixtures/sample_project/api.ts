import { handleAuth } from './auth';

export function processRequest(req: Request): Response {
    const user = handleAuth(req);
    return formatResponse(user);
}

function formatResponse(data: any): Response {
    return new Response(JSON.stringify(data));
}

export class ApiController {
    handle(req: Request) {
        return processRequest(req);
    }
}
