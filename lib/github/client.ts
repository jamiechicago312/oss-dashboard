const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type RequestOptions = {
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
};

type GraphQlOptions = {
  query: string;
  variables?: Record<string, unknown>;
};

function buildUrl(path: string, query?: RequestOptions["query"]) {
  const url = new URL(`https://api.github.com${path}`);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

export class GitHubClientPool {
  private readonly tokens: string[];
  private cursor = 0;

  constructor(tokens: string[]) {
    this.tokens = tokens.filter(Boolean);
  }

  get tokenCount() {
    return this.tokens.length;
  }

  private nextToken() {
    if (this.tokens.length === 0) {
      return undefined;
    }

    const token = this.tokens[this.cursor % this.tokens.length];
    this.cursor += 1;
    return token;
  }

  async rest<T>(options: RequestOptions): Promise<T> {
    return (await this.request<T>(buildUrl(options.path, options.query), {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
      },
    })) as T;
  }

  async restOptional<T>(options: RequestOptions, allowedStatuses: number[]): Promise<T | null> {
    return this.request<T>(buildUrl(options.path, options.query), {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
      },
    }, 0, allowedStatuses);
  }

  async graphQl<T>(options: GraphQlOptions): Promise<T> {
    return (await this.request<T>(new URL("https://api.github.com/graphql"), {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(options),
    })) as T;
  }

  private async request<T>(
    url: URL,
    init: RequestInit,
    attempt = 0,
    allowedStatuses: number[] = [],
  ): Promise<T | null> {
    const token = this.nextToken();
    const headers = new Headers(init.headers);

    headers.set("User-Agent", "oss-dashboard-local");
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetch(url, {
      ...init,
      headers,
      cache: "no-store",
    });

    if (response.status === 403 || response.status === 429) {
      const reset = response.headers.get("x-ratelimit-reset");
      if (attempt < 3) {
        if (reset) {
          const resetMs = Math.max(Number(reset) * 1000 - Date.now(), 1000);
          await sleep(Math.min(resetMs, 30_000));
        } else {
          await sleep(1500 * (attempt + 1));
        }

        return this.request<T>(url, init, attempt + 1, allowedStatuses);
      }
    }

    const text = await response.text();

    if (allowedStatuses.includes(response.status)) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`GitHub request failed (${response.status}): ${text}`);
    }

    if (text.length === 0) {
      throw new Error(`GitHub request returned an empty body (${response.status}) for ${url.pathname}`);
    }

    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new Error(
        `GitHub request returned invalid JSON (${response.status}) for ${url.pathname}: ${
          error instanceof Error ? error.message : "Unknown parse error"
        }`,
      );
    }
  }
}
