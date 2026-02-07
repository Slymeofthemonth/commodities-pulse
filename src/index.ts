// src/index.ts

import { createAgent } from '@lucid-agents/core';
import { http } from '@lucid-agents/http';
import { createAgentApp } from '@lucid-agents/hono';
import { payments, paymentsFromEnv } from '@lucid-agents/payments';
import { z } from 'zod';

import {
  fetchCommodity,
  fetchAllCommodities,
  fetchHistorical,
  fetchCommoditiesIndex,
  fetchAnalysis,
  COMMODITIES,
  COMMODITY_INFO,
} from './fetchers/alpha-vantage';
import { cache } from './cache';
import agentRegistration from './agent-registration.json';

async function main() {
  const agent = await createAgent({
    name: 'commodities-pulse',
    version: '1.0.0',
    description: 'Real-time commodity prices: crude oil, natural gas, metals, agriculture. Powered by Alpha Vantage.',
  })
    .use(http())
    .use(payments({ config: paymentsFromEnv() }))
    .build();

  const { app, addEntrypoint } = await createAgentApp(agent);

  // Health check (free)
  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      agent: 'commodities-pulse',
      timestamp: new Date().toISOString(),
    })
  );

  // ERC-8004 registration endpoint
  app.get('/.well-known/agent-registration.json', (c) => c.json(agentRegistration));

  // Root endpoint - API overview
  app.get('/', (c) =>
    c.json({
      agent: 'commodities-pulse',
      version: '1.0.0',
      description: 'Real-time commodity prices for AI agents',
      endpoints: [
        {
          path: '/entrypoints/price/invoke',
          method: 'POST',
          price: '$0.001',
          description: 'Get current price for a single commodity',
          input: { commodity: 'wti | brent | natural_gas | copper | aluminum | wheat | corn | coffee | cotton | sugar' },
        },
        {
          path: '/entrypoints/all/invoke',
          method: 'POST',
          price: '$0.005',
          description: 'Get prices for all major commodities',
        },
        {
          path: '/entrypoints/historical/invoke',
          method: 'POST',
          price: '$0.002',
          description: 'Get historical prices for a commodity',
          input: { commodity: 'string', interval: 'daily | weekly | monthly', limit: 'number (1-60)' },
        },
        {
          path: '/entrypoints/index/invoke',
          method: 'POST',
          price: '$0.001',
          description: 'Get the global commodities price index',
        },
        {
          path: '/entrypoints/analysis/invoke',
          method: 'POST',
          price: '$0.003',
          description: 'Enriched analysis: price + 7d/30d/90d changes + moving averages + volatility + trend signals',
          input: { commodity: 'wti | brent | natural_gas | copper | aluminum | wheat | corn | coffee | cotton | sugar' },
        },
      ],
      free: [
        { path: '/health', description: 'Health check' },
        { path: '/commodities', description: 'List available commodities' },
      ],
      commodities: Object.keys(COMMODITIES).filter((k) => k !== 'all'),
    })
  );

  // List commodities (free)
  app.get('/commodities', (c) =>
    c.json({
      commodities: Object.entries(COMMODITY_INFO).map(([key, info]) => ({
        key,
        ...info,
        alphaVantageFunction: COMMODITIES[key],
      })),
    })
  );

  // Single commodity price ($0.001)
  addEntrypoint({
    key: 'price',
    description: 'Returns: {name, price, unit, date, category, description}. Commodities: wti, brent, natural_gas, copper, aluminum, wheat, corn, coffee, cotton, sugar',
    input: z.object({
      commodity: z.string().describe('Commodity name (e.g., wti, brent, natural_gas, copper, wheat)'),
      interval: z.enum(['daily', 'weekly', 'monthly']).optional().default('daily'),
    }),
    price: '0.001',
    handler: async (ctx) => {
      const { commodity, interval } = ctx.input;
      const key = commodity.toLowerCase().replace(/[- ]/g, '_');

      if (!COMMODITIES[key]) {
        return {
          output: {
            error: 'Unknown commodity',
            available: Object.keys(COMMODITIES).filter((k) => k !== 'all'),
          },
        };
      }

      const data = await cache.get(
        `commodity:${key}:${interval}`,
        () => fetchCommodity(key, interval),
        60000 // 1 minute cache
      );

      if (!data) {
        return { output: { error: 'No data available' } };
      }

      const info = COMMODITY_INFO[key];
      return {
        output: {
          ...data,
          category: info?.category,
          description: info?.description,
          fetchedAt: new Date().toISOString(),
          cacheAge: cache.getAge(`commodity:${key}:${interval}`) || 0,
        },
      };
    },
  });

  // All commodities ($0.005)
  addEntrypoint({
    key: 'all',
    description: 'Returns: {commodities: {wti: {name, price, unit, date}, brent: {...}, ...}, count, interval}. All 10 commodities in one call',
    input: z.object({
      interval: z.enum(['daily', 'weekly', 'monthly']).optional().default('daily'),
    }),
    price: '0.005',
    handler: async (ctx) => {
      const { interval } = ctx.input;

      const data = await cache.get(
        `all:${interval}`,
        () => fetchAllCommodities(interval),
        120000 // 2 minute cache (more expensive call)
      );

      return {
        output: {
          commodities: data,
          count: Object.keys(data).length,
          interval,
          fetchedAt: new Date().toISOString(),
        },
      };
    },
  });

  // Historical prices ($0.002)
  addEntrypoint({
    key: 'historical',
    description: 'Returns: {commodity, interval, dataPoints, history: [{date, price}, ...]}. Up to 60 data points, daily/weekly/monthly intervals',
    input: z.object({
      commodity: z.string().describe('Commodity name'),
      interval: z.enum(['daily', 'weekly', 'monthly']).optional().default('monthly'),
      limit: z.number().min(1).max(60).optional().default(12),
    }),
    price: '0.002',
    handler: async (ctx) => {
      const { commodity, interval, limit } = ctx.input;
      const key = commodity.toLowerCase().replace(/[- ]/g, '_');

      if (!COMMODITIES[key]) {
        return {
          output: {
            error: 'Unknown commodity',
            available: Object.keys(COMMODITIES).filter((k) => k !== 'all'),
          },
        };
      }

      const data = await cache.get(
        `historical:${key}:${interval}:${limit}`,
        () => fetchHistorical(key, interval, limit),
        300000 // 5 minute cache for historical
      );

      if (!data) {
        return { output: { error: 'No data available' } };
      }

      const info = COMMODITY_INFO[key];
      return {
        output: {
          commodity: info?.description || key,
          interval,
          dataPoints: data.length,
          history: data,
          fetchedAt: new Date().toISOString(),
        },
      };
    },
  });

  // Global commodities index ($0.001)
  addEntrypoint({
    key: 'index',
    description: 'Returns: {name, value, unit, date}. IMF Primary Commodity Price Index (global aggregate)',
    input: z.object({}),
    price: '0.001',
    handler: async () => {
      const data = await cache.get(
        'commodities-index',
        fetchCommoditiesIndex,
        300000 // 5 minute cache
      );

      if (!data) {
        return { output: { error: 'No data available' } };
      }

      return {
        output: {
          ...data,
          fetchedAt: new Date().toISOString(),
        },
      };
    },
  });

  // Analysis endpoint - enriched data with signals ($0.003)
  addEntrypoint({
    key: 'analysis',
    description: 'Returns: {current: {price, unit, date}, changes: {day7, day30, day90}, movingAverages: {ma7, ma30}, volatility: {daily, level}, signal: {vs7dma, vs30dma, trend}}',
    input: z.object({
      commodity: z.string().describe('Commodity name (e.g., wti, brent, natural_gas, copper, wheat)'),
    }),
    price: '0.003',
    handler: async (ctx) => {
      const { commodity } = ctx.input;
      const key = commodity.toLowerCase().replace(/[- ]/g, '_');

      if (!COMMODITIES[key]) {
        return {
          output: {
            error: 'Unknown commodity',
            available: Object.keys(COMMODITIES).filter((k) => k !== 'all'),
          },
        };
      }

      const data = await cache.get(
        `analysis:${key}`,
        () => fetchAnalysis(key),
        120000 // 2 minute cache
      );

      if (!data) {
        return { output: { error: 'No data available' } };
      }

      return {
        output: {
          ...data,
          fetchedAt: new Date().toISOString(),
        },
      };
    },
  });

  const port = Number(process.env.PORT ?? 3000);
  console.log(`commodities-pulse running on port ${port}`);

  Bun.serve({
    port,
    fetch: app.fetch,
  });
}

main().catch(console.error);
