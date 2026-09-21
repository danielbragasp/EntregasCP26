import optimizeRoute from './optimize-route.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const testReq = {
    method: 'POST',
    body: {
      origin: { lat: -23.6914, lng: -46.5646 },
      stops: [
        { id: 'test-1', lat: -23.6955, lng: -46.5658 },
        { id: 'test-2', lat: -23.6882, lng: -46.5601 },
        { id: 'test-3', lat: -23.7002, lng: -46.5587 }
      ],
      maxSeconds: 3600,
      serviceSeconds: 60
    }
  };
  return optimizeRoute(testReq, res);
}
