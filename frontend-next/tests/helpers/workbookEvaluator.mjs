// Small independent Excel-expression evaluator for regression tests. It ignores
// cached results, so assertions exercise the exported formulas after input edits.
export function workbookEvaluator(workbook) {
    const cache = new Map();
    const active = new Set();
    const precedence = { '=': 1, '<>': 1, '>': 1, '<': 1, '>=': 1, '<=': 1, '+': 2, '-': 2, '*': 3, '/': 3, '^': 4 };
    const tokenPattern = /\s*("(?:[^"]|"")*"|(?:(?:'[^']+'|[A-Za-z_][A-Za-z0-9_]*)!)?\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?|\d+(?:\.\d*)?(?:[Ee][+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|<>|>=|<=|[()+\-*/^=<>:,])/gy;
    const num = value => Number(value ?? 0);
    function read(sheet, address) {
        const key = `${sheet}!${address}`;
        if (cache.has(key)) return cache.get(key);
        if (active.has(key)) throw new Error(`Circular reference: ${key}`);
        const worksheet = workbook.getWorksheet(sheet);
        if (!worksheet) throw new Error(`Missing worksheet: ${sheet}`);
        const cell = worksheet.getCell(address);
        active.add(key);
        const value = cell.formula ? evaluate(parse(cell.formula.replace(/^=/, '')), sheet) : cell.value;
        active.delete(key);
        if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Non-finite result: ${key}`);
        cache.set(key, value);
        return value;
    }
    function parse(source) {
        const tokens = [];
        tokenPattern.lastIndex = 0;
        let match;
        while ((match = tokenPattern.exec(source))) tokens.push(match[1]);
        if (tokens.join('').replace(/\s/g, '') !== source.replace(/\s/g, '')) throw new Error(`Unsupported formula: ${source}`);
        let position = 0;
        function expression(minimum = 0) {
            let token = tokens[position++];
            let node;
            if (token === '+' || token === '-') node = { kind: 'unary', op: token, value: expression(4) };
            else if (token === '(') {
                node = expression();
                if (tokens[position++] !== ')') throw new Error(`Unclosed formula: ${source}`);
            } else if (tokens[position] === '(') {
                position++;
                const args = [];
                if (tokens[position] !== ')') {
                    do { args.push(expression()); } while (tokens[position] === ',' && position++);
                }
                if (tokens[position++] !== ')') throw new Error(`Unclosed function: ${source}`);
                node = { kind: 'call', name: token, args };
            } else if (token?.startsWith('"')) node = { kind: 'value', value: token.slice(1, -1).replace(/""/g, '"') };
            else if (/^\d/.test(token ?? '')) node = { kind: 'value', value: Number(token) };
            else node = { kind: 'ref', value: token };
            while (position < tokens.length && (precedence[tokens[position]] ?? -1) >= minimum) {
                const op = tokens[position++];
                node = { kind: 'binary', op, left: node, right: expression(precedence[op] + (op === '^' ? 0 : 1)) };
            }
            return node;
        }
        const result = expression();
        if (position !== tokens.length) throw new Error(`Unparsed formula: ${source}`);
        return result;
    }
    function evaluate(node, sheet) {
        if (node.kind === 'value') return node.value;
        if (node.kind === 'ref') {
            const [prefix, reference] = node.value.includes('!') ? node.value.split('!') : [sheet, node.value];
            const target = prefix.replace(/^'|'$/g, '');
            const [start, end] = reference.replace(/\$/g, '').split(':');
            if (!end) return read(target, start);
            const worksheet = workbook.getWorksheet(target);
            const first = worksheet.getCell(start);
            const last = worksheet.getCell(end);
            const values = [];
            for (let row = first.row; row <= last.row; row++) {
                for (let col = first.col; col <= last.col; col++) values.push(read(target, worksheet.getCell(row, col).address));
            }
            return values;
        }
        if (node.kind === 'unary') return (node.op === '-' ? -1 : 1) * num(evaluate(node.value, sheet));
        if (node.kind === 'binary') {
            const a = num(evaluate(node.left, sheet));
            const b = num(evaluate(node.right, sheet));
            switch (node.op) {
                case '+': return a + b;
                case '-': return a - b;
                case '*': return a * b;
                case '/': if (b === 0) throw new Error('Division by zero'); return a / b;
                case '^': return a ** b;
                case '=': return a === b;
                case '<>': return a !== b;
                case '>': return a > b;
                case '<': return a < b;
                case '>=': return a >= b;
                case '<=': return a <= b;
            }
        }
        const arg = index => evaluate(node.args[index], sheet);
        switch (node.name) {
            case 'IF': return arg(0) ? arg(1) : arg(2);
            case 'IFERROR': try { return arg(0); } catch { return arg(1); }
            case 'AND': return node.args.every((_, i) => Boolean(arg(i)));
            case 'OR': return node.args.some((_, i) => Boolean(arg(i)));
            case 'MAX': return Math.max(...node.args.map((_, i) => num(arg(i))));
            case 'ABS': return Math.abs(num(arg(0)));
            case 'SQRT': return Math.sqrt(num(arg(0)));
            case 'SUM': return node.args.flatMap((_, i) => arg(i)).reduce((sum, v) => sum + num(v), 0);
            case 'SUMIF': {
                if (arg(1) !== '>0') throw new Error('Unsupported SUMIF criterion');
                const values = arg(0), weights = arg(2);
                return values.reduce((sum, v, i) => sum + (num(v) > 0 ? num(weights[i]) : 0), 0);
            }
            case 'MEDIAN': {
                const values = arg(0).filter(v => typeof v === 'number').sort((a, b) => a - b);
                if (!values.length) throw new Error('MEDIAN has no numeric values');
                const middle = Math.floor(values.length / 2);
                return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
            }
            default: throw new Error(`Unsupported function: ${node.name}`);
        }
    }
    return { read, reset() { cache.clear(); active.clear(); } };
}
