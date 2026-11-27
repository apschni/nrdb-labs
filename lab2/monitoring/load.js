import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '1m', target: 15 },
    { duration: '1m', target: 30 },
    { duration: '30s', target: 0 },
  ],
  thresholds: { checks: ['rate>0.99'], http_req_failed: ['rate<0.01'] },
};

export default function () {
  const response = http.get('http://nginx/');
  check(response, { 'nginx responds 200': (r) => r.status === 200 });
  sleep(0.05);
}
