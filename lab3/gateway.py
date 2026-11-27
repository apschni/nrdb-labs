from time import perf_counter

import uvloop
from aiohttp import ClientError, ClientSession, ClientTimeout, TCPConnector, web
from prometheus_client import CollectorRegistry, Counter, Histogram, CONTENT_TYPE_LATEST, generate_latest
from redis.asyncio import Redis
from redis.backoff import NoBackoff
from redis.exceptions import RedisError
from redis.retry import Retry


LIMIT = 1000
WINDOW = 10

SCRIPT = """
    local count = redis.call('INCR', KEYS[1])
    if count == 1 then
        redis.call('EXPIRE', KEYS[1], ARGV[1])
    end
    return {count, redis.call('PTTL', KEYS[1])}
"""

registry = CollectorRegistry()
requests = Counter("gateway_requests_total", "API requests by HTTP status", ["status"], registry=registry)
latency = Histogram(
    "gateway_request_duration_seconds", "API request duration including Redis and upstream",
    buckets=(0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5), registry=registry,
)
for status in ("200", "429", "502", "503"):
    requests.labels(status)


async def connections(app):
    async with Redis.from_url(
        "redis://redis:6379/0",
        socket_connect_timeout=0.5, socket_timeout=0.5,
        max_connections=200, retry=Retry(NoBackoff(), 0),
    ) as redis, ClientSession(
        base_url="http://backend:8000", timeout=ClientTimeout(total=2),
        connector=TCPConnector(limit=100),
    ) as upstream:
        app["redis"] = redis
        app["limit"] = redis.register_script(SCRIPT)
        app["upstream"] = upstream
        yield


routes = web.RouteTableDef()


@routes.get("/api/products")
async def products(request):
    started = perf_counter()
    status = 503
    try:
        try:
            count, ttl = await request.app["limit"](keys=["ratelimit:products"], args=[WINDOW])
        except RedisError:
            return web.json_response({"error": "Rate limiter unavailable"}, status=status)

        reset = max(1, (ttl + 999) // 1000)
        headers = {
            "X-RateLimit-Limit": str(LIMIT),
            "X-RateLimit-Remaining": str(max(0, LIMIT - count)),
            "X-RateLimit-Reset": str(reset),
        }
        if count > LIMIT:
            status = 429
            headers["Retry-After"] = str(reset)
            return web.json_response({"error": "Too many requests"}, status=status, headers=headers)

        try:
            async with request.app["upstream"].get("/products") as response:
                body = await response.read()
                status = response.status
                headers["Content-Type"] = response.headers.get("content-type", "application/json")
                return web.Response(body=body, status=status, headers=headers)
        except (ClientError, TimeoutError):
            status = 502
            return web.json_response({"error": "Upstream unavailable"}, status=status, headers=headers)
    finally:
        requests.labels(str(status)).inc()
        latency.observe(perf_counter() - started)


@routes.get("/health")
async def health(request):
    try:
        await request.app["redis"].ping()
        return web.json_response({"status": "ok"})
    except RedisError:
        return web.json_response({"status": "redis unavailable"}, status=503)


@routes.get("/metrics")
async def metrics(request):
    return web.Response(body=generate_latest(registry), headers={"Content-Type": CONTENT_TYPE_LATEST})


app = web.Application()
app.cleanup_ctx.append(connections)
app.add_routes(routes)

if __name__ == "__main__":
    web.run_app(app, host="0.0.0.0", port=8000, access_log=None, loop=uvloop.new_event_loop())
