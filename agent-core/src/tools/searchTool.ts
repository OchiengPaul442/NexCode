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

    const escaped = query.replace(/"/g, '\\"');
    const rgResult = await this.terminal.run(
      `rg --line-number --no-heading "${escaped}" .`,
    );

    if (rgResult.ok) {
      return rgResult;
    }

    return this.terminal.run(`grep -R -n "${escaped}" .`);
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
      const url =
        `https://api.duckduckgo.com/?q=${encodedQuery}` +
        `&format=json&no_html=1&skip_disambig=1`;

      const json = await this.fetchJson<DuckDuckGoResponse>(url, {
        method: "GET",
      });

      const abstractText = json.AbstractText?.trim() || "";
      const abstractUrl = json.AbstractURL?.trim() || "";
      const heading = json.Heading?.trim() || "";
      const related = this.flattenDuckTopics(json.RelatedTopics ?? []).slice(
        0,
        5,
      );

      if (!abstractText && related.length === 0) {
        return {
          ok: false,
          output: "DuckDuckGo returned no useful results.",
        };
      }

      const lines = [
        `Web search provider: DuckDuckGo fallback`,
        `Query: ${query}`,
      ];

      if (abstractText) {
        const abstractLabel = heading ? `Summary (${heading})` : "Summary";
        lines.push("", `${abstractLabel}: ${this.compact(abstractText, 400)}`);
        if (abstractUrl) {
          lines.push(`Source: ${abstractUrl}`);
        }
      }

      if (related.length > 0) {
        lines.push("", "Related results:");
        for (let index = 0; index < related.length; index += 1) {
          const item = related[index];
          lines.push(
            `${index + 1}. ${this.compact(item.text, 180)} - ${item.url}`,
          );
        }
      }

      return {
        ok: true,
        output: lines.join("\n"),
      };
    } catch (error) {
      return {
        ok: false,
        output: `DuckDuckGo request failed: ${String(error)}`,
      };
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
