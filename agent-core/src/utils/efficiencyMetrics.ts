export interface EfficiencyMetrics {
  tokensPerRequest: number;
  tokensPerFileEdit: number;
  cacheHitRate: number;
  compressionRatio: number;
  parallelSpeedup: number;
  contextUtilization: number;
}

export class EfficiencyTracker {
  private metrics: EfficiencyMetrics = {
    tokensPerRequest: 0,
    tokensPerFileEdit: 0,
    cacheHitRate: 0,
    compressionRatio: 0,
    parallelSpeedup: 0,
    contextUtilization: 0,
  };
  
  private totalTokens = 0;
  private totalRequests = 0;
  private totalEdits = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  
  trackRequest(tokens: number): void {
    this.totalTokens += tokens;
    this.totalRequests++;
    this.metrics.tokensPerRequest = Math.round(this.totalTokens / this.totalRequests);
  }
  
  trackEdit(): void {
    this.totalEdits++;
    this.metrics.tokensPerFileEdit = this.totalEdits > 0 
      ? Math.round(this.totalTokens / this.totalEdits) 
      : 0;
  }
  
  trackCacheHit(): void {
    this.cacheHits++;
    this.updateCacheMetrics();
  }
  
  trackCacheMiss(): void {
    this.cacheMisses++;
    this.updateCacheMetrics();
  }
  
  private updateCacheMetrics(): void {
    const total = this.cacheHits + this.cacheMisses;
    this.metrics.cacheHitRate = total > 0 
      ? Math.round((this.cacheHits / total) * 100) 
      : 0;
  }
  
  trackCompression(original: number, compressed: number): void {
    this.metrics.compressionRatio = original > 0 
      ? Math.round((compressed / original) * 100) 
      : 100;
  }
  
  getMetrics(): EfficiencyMetrics {
    return { ...this.metrics };
  }
}
