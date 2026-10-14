export type RequestSource = 'user' | 'healthcheck' | 'manual';

// An operational label, not authentication or a unique visitor identifier.
export function requestSource(request: Request): RequestSource {
    const marker = request.headers.get('X-DA-Request-Source');
    return marker === 'healthcheck' || marker === 'manual' ? marker : 'user';
}
