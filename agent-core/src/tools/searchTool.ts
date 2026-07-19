import { TerminalTool } from "./terminalTool";
import { ToolResult } from "../types";

type SearchProviderId = "tavily" | "serpapi" | "serper" | "bing" | "duckduckgo" | "custom";

interface SearchToolOptions {
  searchProvider?: SearchProviderId;
  searchApiKey?: string;
  searchBaseUrl?: string;
  tavilyApiKey?: string;
  tavilyBaseUrl?: string;
}

interface SearchResultItem {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilyResponse {
  answer?: string;
  results?: SearchResultItem[];
}

interface SerpApiResponse {
  organic_results?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
  }>;
  answer_box?: {
    answer?: string;
    title?: string;
  };
}

interface SerperResponse {
  organic?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
  }>;
  answer_box?: {
    answer?: string;
    title?: string;
  };
}

interface BingResponse {
  webPages?: {
    value?: Array<{
      name?: string;
      url?: string;
      snippet?: string;
    }>;
  };
  results?: {
    news?: Array<{
      name?: string;
      url?: string;
      description?: string;
    }>;
  };
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
  private readonly searchProvider: SearchProviderId;
  private readonly searchApiKey?: string;
  private readonly searchBaseUrl?: string;
  private readonly tavilyApiKey?: string;
  private readonly tavilyBaseUrl: string;

  public constructor(
    private readonly terminal: TerminalTool,
    options: SearchToolOptions = {},
  ) {
    this.searchProvider = options.searchProvider ?? "tavily";
    this.searchApiKey = options.searchApiKey;
    this.searchBaseUrl = options.searchBaseUrl;
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

    const isWindows = process.platform === "win32";

    // Try rg (ripgrep) first on all platforms — it's the fastest and most capable
    const rgResult = await this.terminal.runSafe(
      "rg",
      ["--line-number", "--no-heading", "--ignore-case", query, "."],
    );
    if (rgResult.ok && rgResult.output) {
      return rgResult;
    }

    if (isWindows) {
      // findstr /s = recursive, /n = line numbers; always available on Windows
      const findstrResult = await this.terminal.runSafe(
        "findstr",
        ["/s", "/n", "/i", query, "*.ts", "*.tsx", "*.js", "*.jsx", "*.json", "*.md", "*.css", "*.html"],
      );
      if (findstrResult.ok && findstrResult.output) {
        return findstrResult;
      }

      // PowerShell Select-String as last resort (comprehensive but slower)
      const escapedQuery = query.replace(/"/g, '""');
      const psResult = await this.terminal.runSafe(
        "powershell",
        ["-NoProfile", "-Command", `Get-ChildItem -Recurse -File | Select-String -Pattern "${escapedQuery}" -SimpleMatch | Select-Object -First 50 | ForEach-Object { "$($_.Path):$($_.LineNumber):$($_.Line.Trim())" }`],
      );
      if (psResult.ok && psResult.output) {
        return psResult;
      }

      return {
        ok: false,
        output: [
          "Workspace search failed.",
          "Tried: ripgrep (rg), findstr, PowerShell Select-String.",
          "",
          "Install ripgrep for best results:",
          "  winget install BurntSushi.ripgrep.MSVC",
          "  scoop install ripgrep",
          "  choco install ripgrep",
          "",
          `Searched for: ${query}`,
        ].join("\n"),
      };
    }

    // Linux/Mac: try grep as fallback
    const grepResult = await this.terminal.runSafe("grep", ["-R", "-n", "-i", query, "."]);
    if (grepResult.ok) {
      return grepResult;
    }

    return {
      ok: false,
      output: [
        "Workspace search failed.",
        "Tried: ripgrep (rg), grep.",
        "",
        "Install ripgrep (recommended) or ensure grep is in your PATH:",
        "  macOS:   brew install ripgrep",
        "  Ubuntu:  sudo apt install ripgrep",
        "  Fedora:  sudo dnf install ripgrep",
        "",
        `Searched for: ${query}`,
      ].join("\n"),
    };
  }

  public async webSearch(query: string): Promise<ToolResult> {
    if (!query.trim()) {
      return {
        ok: false,
        output: "Web search query cannot be empty.",
      };
    }

    // Try the configured provider first
    const configuredResult = await this.searchWithConfiguredProvider(query);
    if (configuredResult.ok) {
      return configuredResult;
    }

    // Fallback to free providers if configured provider fails or has no API key
    const duckResult = await this.searchWithDuckDuckGo(query);
    if (duckResult.ok) {
      return duckResult;
    }

    const wikipediaResult = await this.searchWithWikipediaSummary(query);
    if (wikipediaResult.ok) {
      return wikipediaResult;
    }

    const duckInstantResult = await this.searchWithDuckDuckGoInstant(query);
    if (duckInstantResult.ok) {
      return duckInstantResult;
    }

    return {
      ok: false,
      output: [
        `Web search failed for query: ${query}`,
        `Configured provider (${this.searchProvider}): ${configuredResult.output}`,
        `DuckDuckGo: ${duckResult.output}`,
        `Wikipedia: ${wikipediaResult.output}`,
        `DuckDuckGo Instant: ${duckInstantResult.output}`,
        ``,
        `Tip: Configure a search API key in settings for better results.`,
        `Tip: Check your internet connection and try again.`,
      ].join("\n"),
    };
  }

  private async searchWithConfiguredProvider(query: string): Promise<ToolResult> {
    // DuckDuckGo doesn't need an API key
    if (this.searchProvider === "duckduckgo") {
      return this.searchWithDuckDuckGo(query);
    }

    const apiKey = this.searchApiKey || this.tavilyApiKey || process.env.SEARCH_API_KEY || process.env.TAVILY_API_KEY;
    
    if (!apiKey && this.searchProvider !== "custom") {
      return {
        ok: false,
        output: `No API key configured for ${this.searchProvider}. Add one in Settings.`,
      };
    }

    switch (this.searchProvider) {
      case "tavily":
        return this.searchWithTavily(query);
      case "serpapi":
        return this.searchWithSerpAPI(query);
      case "serper":
        return this.searchWithSerper(query);
      case "bing":
        return this.searchWithBing(query);
      case "custom":
        return this.searchWithCustomProvider(query);
      default:
        return this.searchWithTavily(query);
    }
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
        sources: results.map(r => ({
          title: r.title?.trim() || "Untitled",
          url: r.url?.trim() || "",
          snippet: r.content?.trim()?.slice(0, 200),
        })),
      };
    } catch (error) {
      return {
        ok: false,
        output: `Tavily request failed: ${String(error)}`,
      };
    }
  }

  private async searchWithSerpAPI(query: string): Promise<ToolResult> {
    const apiKey = this.searchApiKey;
    if (!apiKey) {
      return { ok: false, output: "SerpAPI key not configured." };
    }

    try {
      const baseUrl = this.searchBaseUrl || "https://serpapi.com/search";
      const url = `${baseUrl}?q=${encodeURIComponent(query)}&api_key=${apiKey}&engine=google&num=5`;
      
      const json = await this.fetchJson<SerpApiResponse>(url, { method: "GET" });
      
      const answer = json.answer_box?.answer;
      const results = json.organic_results?.slice(0, 5) || [];

      if (!answer && results.length === 0) {
        return { ok: false, output: "SerpAPI returned no results." };
      }

      const lines = [`Web search provider: SerpAPI`, `Query: ${query}`];
      if (answer) {
        lines.push("", `Answer: ${this.compact(answer, 400)}`);
      }

      if (results.length > 0) {
        lines.push("", "Top results:");
        for (let i = 0; i < results.length; i++) {
          const item = results[i];
          lines.push(`${i + 1}. ${item.title || "Untitled"} - ${item.link || "(no url)"}`);
          if (item.snippet) {
            lines.push(`   ${this.compact(item.snippet, 220)}`);
          }
        }
      }

      return {
        ok: true,
        output: lines.join("\n"),
        sources: results.map(r => ({
          title: r.title?.trim() || "Untitled",
          url: r.link?.trim() || "",
          snippet: r.snippet?.trim()?.slice(0, 200),
        })),
      };
    } catch (error) {
      return { ok: false, output: `SerpAPI request failed: ${String(error)}` };
    }
  }

  private async searchWithSerper(query: string): Promise<ToolResult> {
    const apiKey = this.searchApiKey;
    if (!apiKey) {
      return { ok: false, output: "Serper key not configured." };
    }

    try {
      const baseUrl = this.searchBaseUrl || "https://google.serper.dev/search";
      
      const json = await this.fetchJson<SerperResponse>(baseUrl, {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ q: query, num: 5 }),
      });

      const answer = json.answer_box?.answer;
      const results = json.organic?.slice(0, 5) || [];

      if (!answer && results.length === 0) {
        return { ok: false, output: "Serper returned no results." };
      }

      const lines = [`Web search provider: Serper`, `Query: ${query}`];
      if (answer) {
        lines.push("", `Answer: ${this.compact(answer, 400)}`);
      }

      if (results.length > 0) {
        lines.push("", "Top results:");
        for (let i = 0; i < results.length; i++) {
          const item = results[i];
          lines.push(`${i + 1}. ${item.title || "Untitled"} - ${item.link || "(no url)"}`);
          if (item.snippet) {
            lines.push(`   ${this.compact(item.snippet, 220)}`);
          }
        }
      }

      return {
        ok: true,
        output: lines.join("\n"),
        sources: results.map(r => ({
          title: r.title?.trim() || "Untitled",
          url: r.link?.trim() || "",
          snippet: r.snippet?.trim()?.slice(0, 200),
        })),
      };
    } catch (error) {
      return { ok: false, output: `Serper request failed: ${String(error)}` };
    }
  }

  private async searchWithBing(query: string): Promise<ToolResult> {
    const apiKey = this.searchApiKey;
    if (!apiKey) {
      return { ok: false, output: "Bing API key not configured." };
    }

    try {
      const baseUrl = this.searchBaseUrl || "https://api.bing.microsoft.com/v7.0/search";
      const url = `${baseUrl}?q=${encodeURIComponent(query)}&count=5`;
      
      const json = await this.fetchJson<BingResponse>(url, {
        method: "GET",
        headers: { "Ocp-Apim-Subscription-Key": apiKey },
      });

      const results = json.webPages?.value?.slice(0, 5) || [];

      if (results.length === 0) {
        return { ok: false, output: "Bing returned no results." };
      }

      const lines = [`Web search provider: Bing`, `Query: ${query}`, "", "Top results:"];
      for (let i = 0; i < results.length; i++) {
        const item = results[i];
        lines.push(`${i + 1}. ${item.name || "Untitled"} - ${item.url || "(no url)"}`);
        if (item.snippet) {
          lines.push(`   ${this.compact(item.snippet, 220)}`);
        }
      }

      return {
        ok: true,
        output: lines.join("\n"),
        sources: results.map(r => ({
          title: r.name?.trim() || "Untitled",
          url: r.url?.trim() || "",
          snippet: r.snippet?.trim()?.slice(0, 200),
        })),
      };
    } catch (error) {
      return { ok: false, output: `Bing request failed: ${String(error)}` };
    }
  }

  private async searchWithCustomProvider(query: string): Promise<ToolResult> {
    const apiKey = this.searchApiKey;
    const baseUrl = this.searchBaseUrl;
    
    if (!baseUrl) {
      return { ok: false, output: "Custom search API base URL not configured." };
    }

    try {
      const url = `${baseUrl}?q=${encodeURIComponent(query)}`;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const response = await this.fetchWithTimeout(url, {
        method: "GET",
        headers,
      }, 15000);

      if (!response.ok) {
        return { ok: false, output: `Custom API returned status ${response.status}` };
      }

      const json = await response.json();
      
      // Try to extract results from common response formats
      const results = json.results || json.data || json.webPages?.value || [];
      const answer = json.answer || json.answer_box?.answer;

      const lines = [`Web search provider: Custom`, `Query: ${query}`];
      if (answer) {
        lines.push("", `Answer: ${this.compact(answer, 400)}`);
      }

      if (Array.isArray(results) && results.length > 0) {
        lines.push("", "Top results:");
        for (let i = 0; i < Math.min(results.length, 5); i++) {
          const item = results[i];
          const title = item.title || item.name || "Untitled";
          const url = item.url || item.link || "(no url)";
          const snippet = item.content || item.snippet || item.description || "";
          lines.push(`${i + 1}. ${title} - ${url}`);
          if (snippet) {
            lines.push(`   ${this.compact(snippet, 220)}`);
          }
        }
      }

      return {
        ok: true,
        output: lines.join("\n"),
        sources: results.map((r: any) => ({
          title: r.title?.trim() || "Untitled",
          url: r.url?.trim() || r.link?.trim() || "",
          snippet: r.snippet?.trim()?.slice(0, 200),
        })),
      };
    } catch (error) {
      return { ok: false, output: `Custom search request failed: ${String(error)}` };
    }
  }

  private async searchWithDuckDuckGo(query: string): Promise<ToolResult> {
    try {
      const encodedQuery = encodeURIComponent(query);
      const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

      const response = await this.fetchWithTimeout(url, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      }, 15000);

      if (!response.ok) {
        return { ok: false, output: `DuckDuckGo returned status ${response.status}` };
      }

      const html = await response.text();
      const results = this.parseDuckDuckGoHtml(html);

      if (results.length === 0) {
        return { ok: false, output: "DuckDuckGo returned no useful results." };
      }

      const lines = [
        `Web search provider: DuckDuckGo (HTML)`,
        `Query: ${query}`,
        "",
        `Found ${results.length} results:`,
        "",
      ];

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        lines.push(`${i + 1}. ${r.title}`);
        lines.push(`   URL: ${r.url}`);
        if (r.snippet) {
          lines.push(`   ${this.compact(r.snippet, 250)}`);
        }
        lines.push("");
      }

      return {
        ok: true,
        output: lines.join("\n"),
        sources: results.map(r => ({
          title: r.title?.trim() || "Untitled",
          url: r.url?.trim() || "",
          snippet: r.snippet?.trim()?.slice(0, 200),
        })),
      };
    } catch (error) {
      const msg = String(error);
      if (msg.includes("abort") || msg.includes("timeout") || msg.includes("network")) {
        return { ok: false, output: `DuckDuckGo search failed: Network timeout. Check your internet connection.` };
      }
      return { ok: false, output: `DuckDuckGo search failed: ${msg}` };
    }
  }

  private parseDuckDuckGoHtml(html: string): Array<{ title: string; url: string; snippet: string }> {
    const results: Array<{ title: string; url: string; snippet: string }> = [];

    // Pattern 1: result__a class with result__snippet
    const resultRegex = /<a[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<(?:a|div|span)[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/gi;
    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < 5) {
      const rawUrl = match[1]?.trim() || "";
      const title = this.stripHtml(match[2]);
      const snippet = this.stripHtml(match[3]);
      const url = this.resolveDuckDuckGoUrl(rawUrl);
      if (title && url) {
        results.push({ title, url, snippet });
      }
    }

    // Pattern 2: result__a without snippet
    if (results.length === 0) {
      const simpleRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      while ((match = simpleRegex.exec(html)) !== null && results.length < 5) {
        const rawUrl = match[1]?.trim() || "";
        const title = this.stripHtml(match[2]);
        const url = this.resolveDuckDuckGoUrl(rawUrl);
        if (title && url && !url.includes("duckduckgo.com")) {
          results.push({ title, url, snippet: "" });
        }
      }
    }

    // Pattern 3: result__title
    if (results.length === 0) {
      const titleRegex = /<a[^>]*class="result__title"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      while ((match = titleRegex.exec(html)) !== null && results.length < 5) {
        const rawUrl = match[1]?.trim() || "";
        const title = this.stripHtml(match[2]);
        const url = this.resolveDuckDuckGoUrl(rawUrl);
        if (title && url && !url.includes("duckduckgo.com")) {
          results.push({ title, url, snippet: "" });
        }
      }
    }

    // Pattern 4: any external link as fallback
    if (results.length === 0) {
      const linkRegex = /<a[^>]*href="(https?:\/\/(?!duckduckgo\.com|google\.com|bing\.com)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      while ((match = linkRegex.exec(html)) !== null && results.length < 5) {
        const url = match[1]?.trim() || "";
        const title = this.stripHtml(match[2]);
        if (title && url && title.length > 5) {
          results.push({ title, url, snippet: "" });
        }
      }
    }

    return results;
  }

  private resolveDuckDuckGoUrl(rawUrl: string): string {
    // DuckDuckGo wraps URLs in redirects; extract the actual URL
    const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      return decodeURIComponent(uddgMatch[1]);
    }
    if (rawUrl.startsWith("/")) {
      return ""; // Skip relative URLs
    }
    return rawUrl;
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .trim();
  }

  private async searchWithWikipediaSummary(query: string): Promise<ToolResult> {
    try {
      const encodedQuery = encodeURIComponent(query);
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodedQuery}`;

      const response = await this.fetchWithTimeout(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      }, 15000);

      if (!response.ok) {
        if (response.status === 404) {
          return { ok: false, output: "Wikipedia has no article for this query." };
        }
        return { ok: false, output: `Wikipedia returned status ${response.status}` };
      }

      const json = (await response.json()) as {
        title?: string;
        extract?: string;
        content_urls?: { desktop?: { page?: string } };
        description?: string;
        type?: string;
      };

      const title = json.title?.trim() || query;
      const extract = json.extract?.trim() || "";
      const pageUrl = json.content_urls?.desktop?.page || "";
      const description = json.description?.trim() || "";
      const type = json.type || "";

      if (!extract && !description) {
        return { ok: false, output: "Wikipedia returned no content for this article." };
      }

      const lines = [
        `Web search provider: Wikipedia`,
        `Query: ${query}`,
        "",
        `Article: ${title} (${type})`,
        `URL: ${pageUrl || `https://en.wikipedia.org/wiki/${encodedQuery}`}`,
        "",
      ];

      if (description) {
        lines.push(`Description: ${this.compact(description, 300)}`, "");
      }

      if (extract) {
        lines.push(`Summary:`, this.compact(extract, 500));
      }

      return {
        ok: true,
        output: lines.join("\n"),
        sources: [{
          title: title || "Wikipedia Article",
          url: pageUrl || `https://en.wikipedia.org/wiki/${encodedQuery}`,
          snippet: description?.slice(0, 200),
        }],
      };
    } catch (error) {
      const msg = String(error);
      if (msg.includes("abort") || msg.includes("timeout") || msg.includes("network")) {
        return { ok: false, output: `Wikipedia search failed: Network timeout. Check your internet connection.` };
      }
      return { ok: false, output: `Wikipedia search failed: ${msg}` };
    }
  }

  private async searchWithDuckDuckGoInstant(query: string): Promise<ToolResult> {
    try {
      const encodedQuery = encodeURIComponent(query);
      const url = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`;

      const json = await this.fetchJson<DuckDuckGoResponse>(url, { method: "GET" }, 10000);

      const abstract = json.AbstractText?.trim() || "";
      const heading = json.Heading?.trim() || query;
      const abstractUrl = json.AbstractURL?.trim() || "";

      const lines = [
        `Web search provider: DuckDuckGo (Instant)`,
        `Query: ${query}`,
        "",
        `Topic: ${heading}`,
      ];

      if (abstractUrl) {
        lines.push(`URL: ${abstractUrl}`);
      }

      lines.push("");

      if (abstract) {
        lines.push(`Summary:`, this.compact(abstract, 500), "");
      }

      // Include related topics
      if (Array.isArray(json.RelatedTopics) && json.RelatedTopics.length > 0) {
        const flatTopics = this.flattenDuckTopics(json.RelatedTopics).slice(0, 5);
        if (flatTopics.length > 0) {
          lines.push("Related topics:");
          for (const t of flatTopics) {
            lines.push(`  - ${this.compact(t.text, 120)}`);
            lines.push(`    ${t.url}`);
          }
        }
      }

      if (!abstract && (!json.RelatedTopics || json.RelatedTopics.length === 0)) {
        return { ok: false, output: "DuckDuckGo Instant returned no useful results." };
      }

      const sources: Array<{ title: string; url: string; snippet?: string }> = [];

      if (abstract && abstractUrl) {
        sources.push({
          title: heading || "DuckDuckGo Instant Answer",
          url: abstractUrl,
          snippet: abstract?.slice(0, 200),
        });
      }

      if (Array.isArray(json.RelatedTopics)) {
        const flatTopics = this.flattenDuckTopics(json.RelatedTopics).slice(0, 5);
        for (const t of flatTopics) {
          sources.push({
            title: t.text?.slice(0, 100) || "Related Topic",
            url: t.url,
            snippet: t.text?.slice(0, 200),
          });
        }
      }

      return { ok: true, output: lines.join("\n"), sources };
    } catch (error) {
      return { ok: false, output: `DuckDuckGo Instant search failed: ${String(error)}` };
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
