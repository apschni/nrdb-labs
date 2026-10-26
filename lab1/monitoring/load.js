import mongo from 'k6/x/mongo';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

if (!__ENV.MONGODB_PASSWORD && !__ENV.MONGODB_URI) throw new Error('Load monitoring/.env before running k6');
const uri = __ENV.MONGODB_URI || 'mongodb://k6_load:' + encodeURIComponent(__ENV.MONGODB_PASSWORD) +
    '@127.0.0.1:27017/university?authSource=university&directConnection=true&maxPoolSize=2';
let client;
const failures = new Rate('mongo_failures');
const duration = new Trend('mongo_operation_duration', true);
const collection = 'k6_workload';
const documents = 5000;
const payload = 'x'.repeat(2048);

export const options = {
    startVUs: 0,
    stages: [
        { duration: '30s', target: 0 },
        { duration: '30s', target: 10 },
        { duration: '1m', target: 10 },
        { duration: '30s', target: 40 },
        { duration: '1m', target: 40 },
        { duration: '30s', target: 80 },
        { duration: '1m', target: 80 },
        { duration: '30s', target: 0 },
        { duration: '30s', target: 0 },
    ],
    thresholds: { mongo_failures: ['rate<0.01'], checks: ['rate>0.99'] },
    summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
    client = mongo.newClient(uri);
    for (let i = 0; i < documents; i++) {
        client.upsert('university', collection, { _id: String(i) }, { $set: { bucket: i % 100, payload, changes: 0 } });
    }
}

export default function() {
    if (!client) client = mongo.newClient(uri);
    const id = String(Math.floor(Math.random() * documents));
    const choice = Math.random();
    const operation = choice < 0.6 ? 'read' : choice < 0.85 ? 'write' : 'scan';
    const started = Date.now();
    let ok = false;
    try {
        if (operation === 'read') {
            const result = client.findOne('university', collection, { _id: id });
            ok = result !== null && result._id === id;
        } else if (operation === 'write') {
            client.upsert('university', collection, { _id: id }, { $set: { payload, updated: Date.now() }, $inc: { changes: 1 } });
            ok = true;
        } else {
            const result = client.aggregate('university', collection, [
                { $match: { bucket: Number(id) % 100 } },
                { $group: { _id: '$bucket', changes: { $sum: '$changes' } } },
            ]);
            ok = result.length === 1;
        }
    } catch (_) {
        ok = false;
    }
    duration.add(Date.now() - started, { operation });
    failures.add(!ok);
    check(ok, { 'MongoDB operation succeeded': (value) => value });
    sleep(0.02);
}