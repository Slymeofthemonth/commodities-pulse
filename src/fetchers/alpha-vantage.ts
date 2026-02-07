// Alpha Vantage API fetcher for commodities

const API_KEY = process.env.ALPHA_VANTAGE_API_KEY!;
const BASE_URL = 'https://www.alphavantage.co/query';

export interface CommodityPrice {
  name: string;
  price: number;
  unit: string;
  date: string;
  interval: string;
}

export interface CommodityData {
  name: string;
  interval: string;
  unit: string;
  data: Array<{ date: string; value: string }>;
}

// Map of user-friendly names to Alpha Vantage function names
export const COMMODITIES: Record<string, string> = {
  wti: 'WTI',
  brent: 'BRENT',
  natural_gas: 'NATURAL_GAS',
  copper: 'COPPER',
  aluminum: 'ALUMINUM',
  wheat: 'WHEAT',
  corn: 'CORN',
  coffee: 'COFFEE',
  cotton: 'COTTON',
  sugar: 'SUGAR',
  all: 'ALL_COMMODITIES',
};

// User-friendly descriptions
export const COMMODITY_INFO: Record<string, { category: string; description: string }> = {
  wti: { category: 'Energy', description: 'West Texas Intermediate Crude Oil' },
  brent: { category: 'Energy', description: 'Brent Crude Oil' },
  natural_gas: { category: 'Energy', description: 'Henry Hub Natural Gas' },
  copper: { category: 'Metals', description: 'Global Copper' },
  aluminum: { category: 'Metals', description: 'Global Aluminum' },
  wheat: { category: 'Agriculture', description: 'Global Wheat' },
  corn: { category: 'Agriculture', description: 'Global Corn' },
  coffee: { category: 'Agriculture', description: 'Global Coffee (Arabica)' },
  cotton: { category: 'Agriculture', description: 'Global Cotton' },
  sugar: { category: 'Agriculture', description: 'Global Sugar' },
};

export async function fetchCommodity(
  commodity: string,
  interval: 'daily' | 'weekly' | 'monthly' = 'daily'
): Promise<CommodityPrice | null> {
  const fn = COMMODITIES[commodity.toLowerCase()];
  if (!fn) return null;

  const url = `${BASE_URL}?function=${fn}&interval=${interval}&apikey=${API_KEY}`;
  const res = await fetch(url);
  const data: CommodityData = await res.json();

  if (!data.data || data.data.length === 0) return null;

  const latest = data.data[0];
  return {
    name: data.name,
    price: parseFloat(latest.value),
    unit: data.unit,
    date: latest.date,
    interval: data.interval,
  };
}

export async function fetchAllCommodities(
  interval: 'daily' | 'weekly' | 'monthly' = 'daily'
): Promise<Record<string, CommodityPrice | { error: string }>> {
  const commodities = Object.keys(COMMODITIES).filter((k) => k !== 'all');
  const results: Record<string, CommodityPrice | { error: string }> = {};

  // Fetch in parallel but respect rate limits (5 calls/min on free tier)
  for (const commodity of commodities) {
    try {
      const data = await fetchCommodity(commodity, interval);
      if (data) {
        results[commodity] = data;
      } else {
        results[commodity] = { error: 'No data available' };
      }
    } catch (e) {
      results[commodity] = { error: (e as Error).message };
    }
    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 200));
  }

  return results;
}

export async function fetchCommoditiesIndex(): Promise<{
  name: string;
  value: number;
  unit: string;
  date: string;
} | null> {
  const url = `${BASE_URL}?function=ALL_COMMODITIES&interval=monthly&apikey=${API_KEY}`;
  const res = await fetch(url);
  const data: CommodityData = await res.json();

  if (!data.data || data.data.length === 0) return null;

  const latest = data.data[0];
  return {
    name: data.name,
    value: parseFloat(latest.value),
    unit: data.unit,
    date: latest.date,
  };
}

export async function fetchHistorical(
  commodity: string,
  interval: 'daily' | 'weekly' | 'monthly' = 'monthly',
  limit = 12
): Promise<Array<{ date: string; price: number }> | null> {
  const fn = COMMODITIES[commodity.toLowerCase()];
  if (!fn) return null;

  const url = `${BASE_URL}?function=${fn}&interval=${interval}&apikey=${API_KEY}`;
  const res = await fetch(url);
  const data: CommodityData = await res.json();

  if (!data.data || data.data.length === 0) return null;

  return data.data.slice(0, limit).map((d) => ({
    date: d.date,
    price: parseFloat(d.value),
  }));
}

export interface CommodityAnalysis {
  commodity: string;
  name: string;
  category: string;
  current: {
    price: number;
    unit: string;
    date: string;
  };
  changes: {
    day7: number | null;
    day30: number | null;
    day90: number | null;
  };
  movingAverages: {
    ma7: number | null;
    ma30: number | null;
  };
  volatility: {
    daily: number | null;
    level: 'low' | 'medium' | 'high' | 'unknown';
  };
  signal: {
    vs7dma: 'above' | 'below' | 'at' | 'unknown';
    vs30dma: 'above' | 'below' | 'at' | 'unknown';
    trend: 'bullish' | 'bearish' | 'neutral' | 'unknown';
  };
}

function calculateChange(current: number, previous: number): number {
  return ((current - previous) / previous) * 100;
}

function calculateMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(0, period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateVolatility(prices: number[]): number | null {
  if (prices.length < 7) return null;
  const returns: number[] = [];
  for (let i = 1; i < Math.min(prices.length, 30); i++) {
    returns.push((prices[i - 1] - prices[i]) / prices[i]);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  return Math.sqrt(variance) * 100; // as percentage
}

function getVolatilityLevel(vol: number | null): 'low' | 'medium' | 'high' | 'unknown' {
  if (vol === null) return 'unknown';
  if (vol < 1) return 'low';
  if (vol < 3) return 'medium';
  return 'high';
}

function getSignal(current: number, ma: number | null): 'above' | 'below' | 'at' | 'unknown' {
  if (ma === null) return 'unknown';
  const diff = ((current - ma) / ma) * 100;
  if (diff > 1) return 'above';
  if (diff < -1) return 'below';
  return 'at';
}

function getTrend(change7: number | null, change30: number | null): 'bullish' | 'bearish' | 'neutral' | 'unknown' {
  if (change7 === null || change30 === null) return 'unknown';
  if (change7 > 2 && change30 > 0) return 'bullish';
  if (change7 < -2 && change30 < 0) return 'bearish';
  return 'neutral';
}

export async function fetchAnalysis(commodity: string): Promise<CommodityAnalysis | null> {
  const fn = COMMODITIES[commodity.toLowerCase()];
  if (!fn) return null;

  const info = COMMODITY_INFO[commodity.toLowerCase()];
  
  // Fetch daily data for analysis (need ~90 days)
  const url = `${BASE_URL}?function=${fn}&interval=daily&apikey=${API_KEY}`;
  const res = await fetch(url);
  const data: CommodityData = await res.json();

  if (!data.data || data.data.length === 0) return null;

  const prices = data.data.slice(0, 90).map((d) => parseFloat(d.value));
  const current = prices[0];
  const latest = data.data[0];

  // Calculate changes
  const change7 = prices.length > 7 ? calculateChange(current, prices[7]) : null;
  const change30 = prices.length > 30 ? calculateChange(current, prices[30]) : null;
  const change90 = prices.length > 89 ? calculateChange(current, prices[89]) : null;

  // Calculate moving averages
  const ma7 = calculateMA(prices, 7);
  const ma30 = calculateMA(prices, 30);

  // Calculate volatility
  const volatility = calculateVolatility(prices);

  return {
    commodity: commodity.toLowerCase(),
    name: data.name,
    category: info?.category || 'Unknown',
    current: {
      price: current,
      unit: data.unit,
      date: latest.date,
    },
    changes: {
      day7: change7 !== null ? Math.round(change7 * 100) / 100 : null,
      day30: change30 !== null ? Math.round(change30 * 100) / 100 : null,
      day90: change90 !== null ? Math.round(change90 * 100) / 100 : null,
    },
    movingAverages: {
      ma7: ma7 !== null ? Math.round(ma7 * 100) / 100 : null,
      ma30: ma30 !== null ? Math.round(ma30 * 100) / 100 : null,
    },
    volatility: {
      daily: volatility !== null ? Math.round(volatility * 100) / 100 : null,
      level: getVolatilityLevel(volatility),
    },
    signal: {
      vs7dma: getSignal(current, ma7),
      vs30dma: getSignal(current, ma30),
      trend: getTrend(change7, change30),
    },
  };
}
