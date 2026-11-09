import json
import time
import urllib.request

body = json.dumps(
    {
        "text": "你迟到了。",
        "voice": r"E:\散应用\音谷\sonicvale\音色库\参考音频\中文\中文男声·北方口音-SSB0073.wav",
        "lang": "ZH",
        "emo_alpha": 0.8,
    }
).encode("utf-8")

req = urllib.request.Request(
    "http://127.0.0.1:8290/v1/tts",
    data=body,
    headers={"Content-Type": "application/json"},
)

start = time.time()
try:
    with urllib.request.urlopen(req, timeout=900) as r:
        print("STATUS", r.status)
        print(r.read().decode("utf-8"))
except Exception as e:
    print("ERR", type(e).__name__, e)
finally:
    print("ELAPSED", round(time.time() - start, 1))
