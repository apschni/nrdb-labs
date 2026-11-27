import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const accepted = new Counter('accepted');
const limited = new Counter('limited');
http.setResponseCallback(http.expectedStatuses(200, 429));

export const options = {
  scenarios: {
    below_limit: {
      executor: 'constant-arrival-rate', exec: 'normal',
      rate: 20, timeUnit: '1s', duration: '20s', preAllocatedVUs: 5,
    },
    above_limit: {
      executor: 'constant-arrival-rate', exec: 'overload', startTime: '30s',
      rate: 2000, timeUnit: '1s', duration: '1m', preAllocatedVUs: 300,
    },
    recovery: {
      executor: 'per-vu-iterations', exec: 'recovery', startTime: '1m45s',
      vus: 1, iterations: 1, maxDuration: '30s',
    },
  },
  thresholds: {
    checks: ['rate==1'],
    http_req_failed: ['rate==0'],
    http_req_duration: ['p(95)<500'],
    dropped_iterations: ['count==0'],
    'http_reqs{scenario:below_limit}': ['count>=400'],
    'http_reqs{scenario:above_limit}': ['count>=120000'],
    limited: ['count>0'],
  },
};

function request() {
  const response = http.get('http://gateway:8000/api/products');
  if (response.status === 200) accepted.add(1);
  if (response.status === 429) limited.add(1);
  return response;
}

export function normal() {
  const response = request();
  check(response, { 'below limit: 200 with products': r => r.status === 200 && r.json('products').length === 2 });
}

export function overload() {
  const response = request();
  check(response, {
    'overload: 200 or 429': r => r.status === 200 || r.status === 429,
    'overload: retry header on 429': r => r.status !== 429 || Number(r.headers['Retry-After']) >= 1,
  });
}

export function recovery() {
  let passed = 0;
  let blocked = 0;
  for (let i = 0; i < 11; i++) {
    const burst = http.batch(Array.from({ length: 100 }, () => ({
      method: 'GET', url: 'http://gateway:8000/api/products',
    })));
    burst.forEach(r => {
      if (r.status === 200) { accepted.add(1); passed++; }
      if (r.status === 429) { limited.add(1); blocked++; }
    });
  }
  check(null, {
    'burst: exactly 1000 accepted': () => passed === 1000,
    'burst: exactly 100 limited': () => blocked === 100,
  });
  sleep(11);
  check(request(), { 'expired window: 200 again': r => r.status === 200 });
}
