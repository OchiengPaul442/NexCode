import { TerminalTool } from "./terminalTool";
import { ToolResult } from "../types";

interface SearchToolOptions {
  tavilyApiKey?: string;
  tavilyBaseUrl?: string;
}

interface TavilyResultItem {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilyResponse {
  answer?: string;
  results?: TavilyResultItem[];
}

interface DuckDuckGoTopic {
  Text?: string;
  FirstURL?: string;
  Topics?: DuckDuckGoTopic[];
}

interface DuckDuckGoResponse {
  Heading?: string;
  AbstractText?: string;
  AbstractURL?: string;
  RelatedTopics?: DuckDuckGoTopic[];
}

export class SearchTool {
  private readonly tavilyApiKey?: string;
  private readonly tavilyBaseUrl: string;

  public constructor(
    private readonly terminal: TerminalTool,
    options: SearchToolOptions = {},
  ) {
    this.tavilyApiKey = options.tavilyApiKey;
    this.tavilyBaseUrl =
      options.tavilyBaseUrl ?? "https://api.tavily.com/search";
  }

  public async search(query: string): Promise<ToolResult> {
    if (!query.trim()) {
      return {
        ok: false,
        output: "Search query cannot be empty.",
      };
    }

    const rgResult = await this.terminal.runSafe(
      "rg",
      ["--line-number", "--no-heading", query, "."],
    );

    if (rgResult.ok) {
      return rgResult;
    }

    return this.terminal.runSafe("grep", ["-R", "-n", query, "."]);
  }

  public async webSearch(query: string): Promise<ToolResult> {
    if (!query.trim()) {
      return {
        ok: false,
        output: "Web search query cannot be empty.",
      };
    }

    const tavilyResult = await this.searchWithTavily(query);
    if (tavilyResult.ok) {
      return tavilyResult;
    }

    const duckResult = await this.searchWithDuckDuckGo(query);
    if (duckResult.ok) {
      return duckResult;
    }

    const wikipediaResult = await this.searchWithWikipedia(query);
    if (wikipediaResult.ok) {
      return wikipediaResult;
    }

    return {
      ok: false,
      output: [
        `Web search failed for query: ${query}`,
        `Tavily: ${tavilyResult.output}`,
        `DuckDuckGo fallback: ${duckResult.output}`,
        `Wikipedia fallback: ${wikipediaResult.output}`,
      ].join("\n"),
    };
  }

  private async searchWithTavily(query: string): Promise<ToolResult> {
    const apiKey = this.tavilyApiKey ?? process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        output:
          "Tavily API key not configured (set TAVILY_API_KEY or nexcodeKiboko.tavilyApiKey).",
      };
    }

    try {
      const json = await this.fetchJson<TavilyResponse>(this.tavilyBaseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: "advanced",
          include_answer: true,
          max_results: 5,
        }),
      });

      const answer = typeof json.answer === "string" ? json.answer.trim() : "";
      const results = Array.isArray(json.results)
        ? json.results.slice(0, 5)
        : [];

      if (!answer && results.length === 0) {
        return {
          ok: false,
          output: "Tavily returned no results.",
        };
      }

      const lines = [`Web search provider: Tavily`, `Query: ${query}`];
      if (answer) {
        lines.push("", `Answer: ${this.compact(answer, 400)}`);
      }

      if (results.length > 0) {
        lines.push("", "Top results:");
        for (let index = 0; index < results.length; index += 1) {
          const item = results[index];
          const title = item.title?.trim() || "Untitled";
          const url = item.url?.trim() || "(no url)";
          const content = item.content?.trim() || "";

          lines.push(`${index + 1}. ${title} - ${url}`);
          if (content) {
            lines.push(`   ${this.compact(content, 220)}`);
          }
        }
      }

      return {
        ok: true,
        output: lines.join("\n"),
      };
    } catch (error) {
      return {
        ok: false,
        output: `Tavily request failed: ${String(error)}`,
      };
    }
  }

  private async searchWithDuckDuckGo(query: string): Promise<ToolResult> {
    try {
      const encodedQuery = encodeURIComponent(query);
      // Use DuckDuckGo HTML lite endpoint for actual search results
      const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

      const response = await this.fetchWithTimeout(url, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; NexCode/1.0)",
        },
      }, 15000);

      if (!response.ok) {
        return { ok: false, output: `DuckDuckGo returned status ${response.status}` };
      }

      const html = await response.text();

      // Parse results from HTML
      const results: Array<{ title: string; url: string; snippet: string }> = [];
      const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      while ((match = resultRegex.exec(html)) !== null && results.length < 5) {
        const url = match[1]?.trim() || "";
        const title = match[2]?.replace(/<[^>]*>/g, "").trim() || "";
        const snippet = match[3]?.replace(/<[^>]*>/g, "").trim() || "";
        if (title && url) {
          results.push({ title, url, snippet });
        }
      }

      // Fallback: try simpler regex if first pattern doesn't match
      if (results.length === 0) {
        const simpleRegex = /<a[^>]*href="(https?:\/\/[^"]*)"[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/gi;
        while ((match = simpleRegex.exec(html)) !== null && results.length < 5) {
          const url = match[1]?.trim() || "";
          const title = match[2]?.replace(/<[^>]*>/g, "").trim() || "";
          if (title && url && !url.includes("duckduckgo.com")) {
            results.push({ title, url, snippet: "" });
          }
        }
      }

      if (results.length === 0) {
        // Try extracting any links as fallback
        const linkRegex = /<a[^>]*href="(https?:\/\/(?!duckduckgo\.com)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        while ((match = linkRegex.exec(html)) !== null && results.length < 5) {
          const url = match[1]?.trim() || "";
          const title = match[2]?.replace(/<[^>]*>/g, "").trim() || "";
          if (title && url && title.length > 5) {
            results.push({ title, url, snippet: "" });
          }
        }
      }

      if (results.length === 0) {
        return { ok: false, output: "DuckDuckGo returned no useful results." };
      }

      const lines = [
        `Web search provider: DuckDuckGo`,
        `Query: ${query}`,
        "",
        "Results:",
      ];

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        lines.push(`${i + 1}. ${r.title}`);
        lines.push(`   ${r.url}`);
        if (r.snippet) {
          lines.push(`   ${r.snippet.slice(0, 200)}`);
        }
        lines.push("");
      }

      return { ok: true, output: lines.join("\n") };
    } catch (error) {
      return { ok: false, output: `DuckDuckGo search failed: ${String(error)}` };
    }
  }

  private async searchWithWikipedia(query: string): Promise<ToolResult> {
    try {
      const encodedQuery = encodeURIComponent(query);
      const url =
        `https://en.wikipedia.org/w/api.php?action=opensearch` +
        `&search=${encodedQuery}&limit=5&namespace=0&format=json`;

      const json = await this.fetchJson<unknown>(url, {
        method: "GET",
      });

      if (!Array.isArray(json) || json.length < 4) {
        return {
          ok: false,
          output: "Wikipedia response format was unexpected.",
        };
      }

      const titles = Array.isArray(json[1]) ? json[1] : [];
      const descriptions = Array.isArray(json[2]) ? json[2] : [];
      const urls = Array.isArray(json[3]) ? json[3] : [];

      if (titles.length === 0 || urls.length === 0) {
        return {
          ok: false,
          output: "Wikipedia returned no results.",
        };
      }

      const lines = [
        `Web search provider: Wikipedia fallback`,
        `Query: ${query}`,
        "",
        "Top results:",
      ];
      for (let index = 0; index < Math.min(5, titles.length); index += 1) {
        const title = String(titles[index] ?? "Untitled").trim();
        const description = String(descriptions[index] ?? "").trim();
        const resultUrl = String(urls[index] ?? "").trim();

        if (!resultUrl) {
          continue;
        }

        lines.push(`${index + 1}. ${title} - ${resultUrl}`);
        if (description) {
          lines.push(`   ${this.compact(description, 220)}`);
        }
      }

      return {
        ok: true,
        output: lines.join("\n"),
      };
    } catch (error) {
      return {
        ok: false,
        output: `Wikipedia request failed: ${String(error)}`,
      };
    }
  }

  private flattenDuckTopics(
    topics: DuckDuckGoTopic[],
  ): Array<{ text: string; url: string }> {
    const results: Array<{ text: string; url: string }> = [];

    const visit = (topic: DuckDuckGoTopic): void => {
      const text = topic.Text?.trim();
      const url = topic.FirstURL?.trim();
      if (text && url) {
        results.push({ text, url });
      }

      if (Array.isArray(topic.Topics)) {
        for (const nested of topic.Topics) {
          visit(nested);
        }
      }
    };

    for (const topic of topics) {
      visit(topic);
    }

    return results;
  }

  private compact(value: string, maxLength: number): string {
    const collapsed = value.replace(/\s+/g, " ").trim();
    if (collapsed.length <= maxLength) {
      return collapsed;
    }

    return `${collapsed.slice(0, Math.max(0, maxLength - 3))}...`;
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs = 15_000,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchJson<T>(
    url: string,
    init: RequestInit,
    timeoutMs = 15_000,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`HTTP ${response.status}: ${body}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
