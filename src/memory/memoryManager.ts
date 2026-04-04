export class MemoryManager {
  private static _instance: MemoryManager | undefined;
  private context: any;
  private memKey = "kiboko.memories";
  private inMemory: Array<any> = [];

  private constructor(context?: any) {
    this.context = context;
  }

  public static init(context?: any) {
    if (!MemoryManager._instance)
      MemoryManager._instance = new MemoryManager(context);
    else MemoryManager._instance.context = context;
    return MemoryManager._instance;
  }

  public static getInstance(context?: any) {
    if (!MemoryManager._instance)
      MemoryManager._instance = new MemoryManager(context);
    else if (context && !MemoryManager._instance.context)
      MemoryManager._instance.context = context;
    return MemoryManager._instance;
  }

  private async _read(): Promise<Array<any>> {
    try {
      if (
        this.context &&
        this.context.globalState &&
        typeof this.context.globalState.get === "function"
      ) {
        return (await this.context.globalState.get(this.memKey)) || [];
      }
    } catch (e) {}
    return this.inMemory.slice();
  }

  private async _write(list: Array<any>) {
    try {
      if (
        this.context &&
        this.context.globalState &&
        typeof this.context.globalState.update === "function"
      ) {
        await this.context.globalState.update(this.memKey, list);
        return;
      }
    } catch (e) {}
    this.inMemory = list.slice();
  }

  public async addMemory(text: string, meta: any = {}) {
    const item = {
      id:
        (Date.now().valueOf() || Date.now()).toString(36) +
        Math.random().toString(36).slice(2, 9),
      text: String(text || ""),
      meta: meta || {},
      created: new Date().toISOString(),
    };
    const list = await this._read();
    list.push(item);
    await this._write(list);
    return item;
  }

  public async listMemories() {
    return await this._read();
  }

  public async queryMemories(q: string) {
    const list = await this._read();
    if (!q) return list;
    const s = String(q).toLowerCase();
    return list.filter(
      (m) =>
        String(m.text || "")
          .toLowerCase()
          .includes(s) ||
        JSON.stringify(m.meta || {})
          .toLowerCase()
          .includes(s),
    );
  }

  // Relevance scoring: prefer vector (TF-cosine) similarity, fallback to token overlap
  public async queryMemoriesByRelevance(q: string, topN = 3) {
    const list = await this._read();
    if (!q) return [];
    const normalize = (str: string) =>
      String(str || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(Boolean);

    // small stopword list to improve vector signal
    const stopwords = new Set([
      "the",
      "is",
      "a",
      "an",
      "and",
      "or",
      "in",
      "on",
      "at",
      "to",
      "of",
      "for",
      "my",
      "your",
      "this",
      "that",
      "it",
      "with",
      "as",
      "are",
      "be",
      "by",
      "from",
      "i",
      "you",
      "what",
      "who",
      "when",
      "where",
      "how",
      "why",
    ]);

    const qTokens = normalize(q).filter((t) => !stopwords.has(t));
    if (qTokens.length === 0) return [];

    const buildVec = (tokens: string[]) => {
      const v: Record<string, number> = {};
      for (const t of tokens) {
        if (stopwords.has(t)) continue;
        v[t] = (v[t] || 0) + 1;
      }
      return v;
    };

    const dot = (a: Record<string, number>, b: Record<string, number>) => {
      let s = 0;
      const aKeys = Object.keys(a);
      const bKeys = Object.keys(b);
      // iterate over smaller set for efficiency
      if (aKeys.length <= bKeys.length) {
        for (const k of aKeys) if (b[k]) s += (a[k] || 0) * (b[k] || 0);
      } else {
        for (const k of bKeys) if (a[k]) s += (a[k] || 0) * (b[k] || 0);
      }
      return s;
    };

    const mag = (v: Record<string, number>) => {
      let s = 0;
      for (const k in v) s += v[k] * v[k];
      return Math.sqrt(s);
    };

    const qVec = buildVec(qTokens);
    const qMag = mag(qVec);
    if (qMag === 0) return [];

    const scored = list
      .map((m) => {
        const txt = (m.text || "") + " " + JSON.stringify(m.meta || {});
        const mTokens = normalize(txt);
        const mVec = buildVec(mTokens);
        const mMag = mag(mVec);
        if (mMag === 0) return { memory: m, score: 0 };
        const cosine = dot(qVec, mVec) / (qMag * mMag);
        return { memory: m, score: cosine };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    // fallback to token overlap if vector scoring yields nothing
    if (scored.length === 0) {
      const overlap = list
        .map((m) => {
          const txt = (m.text || "") + " " + JSON.stringify(m.meta || {});
          const mTokens = normalize(txt);
          const set = new Set(mTokens);
          let match = 0;
          for (const t of qTokens) if (set.has(t)) match++;
          return { memory: m, score: match };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score);
      return overlap.slice(0, topN).map((s) => s.memory);
    }

    return scored.slice(0, topN).map((s) => s.memory);
  }

  public async deleteMemory(id: string) {
    const list = await this._read();
    const next = list.filter((m) => m.id !== id);
    await this._write(next);
    return true;
  }
}

export default MemoryManager;
