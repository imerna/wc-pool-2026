const ALLOWED = new Set(['standings', 'matches']);
const API_KEY  = process.env.FOOTBALL_API_KEY || '3f78d135cc954c46bb6b8f1cf10b7205';

exports.handler = async (event) => {
  const endpoint = event.queryStringParameters?.endpoint;
  if (!ALLOWED.has(endpoint)) {
    return { statusCode: 400, body: 'Invalid endpoint' };
  }

  const res = await fetch(
    `https://api.football-data.org/v4/competitions/WC/${endpoint}`,
    { headers: { 'X-Auth-Token': API_KEY } }
  );

  return {
    statusCode: res.status,
    headers: { 'Content-Type': 'application/json' },
    body: await res.text(),
  };
};
