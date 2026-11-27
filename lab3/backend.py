import uvloop
from aiohttp import web


async def products(request):
    return web.json_response({"products": [
        {"id": 1, "name": "Notebook", "price": 150},
        {"id": 2, "name": "Pen", "price": 40},
    ]})


app = web.Application()
app.router.add_get("/products", products)

if __name__ == "__main__":
    web.run_app(app, host="0.0.0.0", port=8000, access_log=None, loop=uvloop.new_event_loop())
