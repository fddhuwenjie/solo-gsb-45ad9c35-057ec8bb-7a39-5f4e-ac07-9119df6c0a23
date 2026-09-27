"""会议室投影机选位工作台 — Flask 后端。"""
from flask import Flask, jsonify, render_template, request

import geometry
from examples import EXAMPLES

app = Flask(__name__)


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/examples")
def api_examples():
    return jsonify(EXAMPLES)


@app.post("/api/compute")
def api_compute():
    data = request.get_json(force=True, silent=False)
    try:
        room = data["room"]
        screen = data["screen"]
        schemes = data.get("schemes", [])
        obstacles = data.get("obstacles", [])
        point = data.get("point")
        lens_height = data.get("lens_height")
        results = [
            geometry.compute_scheme(room, screen, s, obstacles, point, lens_height)
            for s in schemes
        ]
    except (KeyError, TypeError, ValueError) as exc:
        return jsonify({"error": f"参数无效: {exc}"}), 400
    return jsonify({"schemes": results})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
