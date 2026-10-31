/* eslint-disable @typescript-eslint/no-require-imports -- Legacy consumers require a CommonJS export. */
const upstream = require('minimatch-patched');

// RegExp-like methods delegate to the nonrecursive upstream matcher instead of
// compiling glob patterns back into potentially expensive regular expressions.
function matchResult(value, matches) {
    const input = String(value);
    return matches(input) ? Object.assign([input], { index: 0, input }) : null;
}

function createApi(defaultOptions = {}) {
    const optionsWithDefaults = options => ({ ...defaultOptions, ...options });

    class Minimatch extends upstream.Minimatch {
        constructor(pattern, options) {
            super(pattern, optionsWithDefaults(options));
        }

        static defaults(options) {
            return createApi(optionsWithDefaults(options)).Minimatch;
        }

        parse(pattern) {
            const part = super.parse(pattern);
            // glob 7 reads _glob and calls String.match() on parsed segments.
            // Preserve the upstream Matcher object for its internal algorithms.
            if (part && typeof part.test === 'function') {
                part._glob = pattern;
                part[Symbol.match] = value => matchResult(value, input => part.test(input));
            }
            return part;
        }

        makeRe() {
            return {
                test: value => this.match(String(value)),
                [Symbol.match]: value => matchResult(value, input => this.match(input)),
            };
        }
    }

    const minimatch = (value, pattern, options) => upstream.minimatch(value, pattern, optionsWithDefaults(options));
    return Object.assign(minimatch, upstream, {
        minimatch,
        Minimatch,
        defaults: options => createApi(optionsWithDefaults(options)),
        makeRe: (pattern, options) => new Minimatch(pattern, options).makeRe(),
        filter: (pattern, options) => value => minimatch(value, pattern, options),
        match: (list, pattern, options) => upstream.match(list, pattern, optionsWithDefaults(options)),
        braceExpand: (pattern, options) => upstream.braceExpand(pattern, optionsWithDefaults(options)),
        escape: (value, options) => upstream.escape(value, optionsWithDefaults(options)),
        unescape: (value, options) => upstream.unescape(value, optionsWithDefaults(options)),
    });
}

module.exports = createApi();
