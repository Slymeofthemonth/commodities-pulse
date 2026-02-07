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
