import aliases from './apiRouteAliases.json';

function templatePattern(template: string): RegExp {
    return new RegExp(`^${template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/<\w+>/g, '([^/]+)')}$`, 'i');
}

const preferred = new Map<string, string>();
for (const [canonical, legacy] of Object.entries(aliases)) {
    if (!preferred.has(legacy)) preferred.set(legacy, canonical);
}

const routes = Object.entries(aliases).map(([canonical, legacy]) => ({
    preferred: preferred.get(legacy) === canonical,
    canonical: canonical.replace(/^\/api\//, ''),
    legacy: legacy.replace(/^\/api\//, ''),
})).sort((a, b) => {
    // Match named collections before the generic /stocks/<symbol> route.
    const parameters = (value: string) => (value.match(/</g) || []).length;
    return parameters(a.canonical) - parameters(b.canonical)
        || b.canonical.length - a.canonical.length;
}).map(route => ({ ...route,
    canonicalPattern: templatePattern(route.canonical),
    legacyPattern: templatePattern(route.legacy),
}));

function translate(path: string, direction: 'canonical' | 'legacy'): string {
    for (const route of routes) {
        if (direction === 'canonical' && !route.preferred) continue;
        const pattern = direction === 'legacy' ? route.canonicalPattern : route.legacyPattern;
        const match = pattern.exec(path);
        if (!match) continue;
        let index = 0;
        return route[direction].replace(/<\w+>/g, () => match[++index]);
    }
    return path;
}

/** Keep upstream transport compatible during independent frontend/backend rollouts. */
export const backendApiPath = (path: string) => translate(path, 'legacy');
export const canonicalApiPath = (path: string) => translate(backendApiPath(path), 'canonical');
