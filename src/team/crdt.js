/* Text CRDT (RGA — Replicated Growable Array with Lamport timestamps) for live co-editing (#732).
   Every character has a unique id (counter@site); inserts reference the id they follow, deletes leave tombstones.
   Concurrent edits from any number of peers converge to the same text regardless of delivery order. */

const cmp = (a, b) => (a.c !== b.c ? a.c - b.c : a.s < b.s ? -1 : a.s > b.s ? 1 : 0);
const key = (c, s) => c + '@' + s;

export class RGA {
    constructor(site) {
        this.site = String(site);
        this.clock = 0;
        this.items = [];          // [{c, s, ch, del}]
        this.byId = new Map();    // "c@s" → item
        this.pending = [];        // ops waiting for their dependencies
    }
    static fromText(site, text) { const d = new RGA(site); if (text) d.localInsert(0, String(text)); return d; }
    static fromSnapshot(site, snap) {
        const d = new RGA(site);
        d.clock = snap.clock || 0;
        for (const [c, s, ch, del] of snap.items || []) { const it = { c, s, ch, del: !!del }; d.items.push(it); d.byId.set(key(c, s), it); }
        return d;
    }
    snapshot() { return { clock: this.clock, items: this.items.map(it => (it.del ? [it.c, it.s, it.ch, 1] : [it.c, it.s, it.ch])) }; }
    text() { let s = ''; for (const it of this.items) if (!it.del) s += it.ch; return s; }
    get length() { let n = 0; for (const it of this.items) if (!it.del) n++; return n; }
    /** Index in items[] of the visible character at position pos (0-based), or -1 for "before everything". */
    _visibleIndex(pos) {
        if (pos < 0) return -1;
        let n = -1;
        for (let i = 0; i < this.items.length; i++) if (!this.items[i].del && ++n === pos) return i;
        return this.items.length - 1;
    }
    _integrate(item, afterKey, hint = -1) {
        let i = afterKey ? (hint >= 0 && this.items[hint] && key(this.items[hint].c, this.items[hint].s) === afterKey ? hint : this.items.indexOf(this.byId.get(afterKey))) + 1 : 0;
        while (i < this.items.length && cmp(this.items[i], item) > 0) i++;
        this.items.splice(i, 0, item);
        this.byId.set(key(item.c, item.s), item);
        return i;
    }
    /** Insert a string at a visible position → one compact op. */
    localInsert(pos, str) {
        str = String(str || '');
        if (!str) return null;
        const vi = this._visibleIndex(pos - 1);
        const prev = vi >= 0 ? this.items[vi] : null;
        const after = pos > 0 && prev ? key(prev.c, prev.s) : null;
        const c0 = this.clock + 1;
        let idx = vi, aft = after;
        for (let k = 0; k < str.length; k++) {
            const it = { c: c0 + k, s: this.site, ch: str[k], del: false };
            idx = this._integrate(it, aft, idx);
            aft = key(it.c, it.s);
        }
        this.clock = c0 + str.length - 1;
        return { k: 'ins', s: this.site, c0, after, text: str };
    }
    /** Delete len visible characters starting at pos → one op listing the ids. */
    localDelete(pos, len) {
        const ids = [];
        let n = -1;
        for (const it of this.items) {
            if (it.del) continue;
            n++;
            if (n >= pos && n < pos + len) { it.del = true; ids.push(key(it.c, it.s)); }
            if (n >= pos + len) break;
        }
        return ids.length ? { k: 'del', ids } : null;
    }
    /** Turn an edit (old text → new text) into ops via common prefix/suffix. */
    localReplace(next) {
        const cur = this.text();
        next = String(next == null ? '' : next);
        if (cur === next) return [];
        let a = 0; const max = Math.min(cur.length, next.length);
        while (a < max && cur.charCodeAt(a) === next.charCodeAt(a)) a++;
        let b = 0;
        while (b < max - a && cur.charCodeAt(cur.length - 1 - b) === next.charCodeAt(next.length - 1 - b)) b++;
        const ops = [];
        const del = this.localDelete(a, cur.length - b - a);
        if (del) ops.push(del);
        const ins = this.localInsert(a, next.slice(a, next.length - b));
        if (ins) ops.push(ins);
        return ops;
    }
    _ready(op) {
        if (op.k === 'ins') return !op.after || this.byId.has(op.after);
        if (op.k === 'del') return op.ids.every(id => this.byId.has(id));
        return true;
    }
    _apply(op) {
        if (op.k === 'ins') {
            if (this.byId.has(key(op.c0, op.s))) return false; // duplicate
            let aft = op.after, idx = -1;
            for (let k = 0; k < op.text.length; k++) {
                const it = { c: op.c0 + k, s: op.s, ch: op.text[k], del: false };
                idx = this._integrate(it, aft, idx);
                aft = key(it.c, it.s);
            }
            this.clock = Math.max(this.clock, op.c0 + op.text.length - 1);
            return true;
        }
        if (op.k === 'del') { let ch = false; for (const id of op.ids) { const it = this.byId.get(id); if (it && !it.del) { it.del = true; ch = true; } } return ch; }
        return false;
    }
    /** Apply remote ops (any order); returns true when the text changed. */
    apply(ops) {
        let changed = false;
        this.pending.push(...[].concat(ops || []));
        let progress = true;
        while (progress && this.pending.length) {
            progress = false;
            for (let i = 0; i < this.pending.length; i++) {
                const op = this.pending[i];
                if (!this._ready(op)) continue;
                this.pending.splice(i--, 1);
                if (this._apply(op)) changed = true;
                progress = true;
            }
        }
        return changed;
    }
}

/** Map a caret offset through a text change (prefix/suffix model) — keeps remote cursors sensible. */
export function mapOffset(offset, before, after) {
    let a = 0; const max = Math.min(before.length, after.length);
    while (a < max && before.charCodeAt(a) === after.charCodeAt(a)) a++;
    let b = 0;
    while (b < max - a && before.charCodeAt(before.length - 1 - b) === after.charCodeAt(after.length - 1 - b)) b++;
    if (offset <= a) return offset;
    if (offset >= before.length - b) return offset + (after.length - before.length);
    return a + (after.length - b - a);
}
