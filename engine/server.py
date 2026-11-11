"""声栞本地引擎：IndexTTS 2.5 的 HTTP 封装。

用 IndexTTS 自带的 venv 启动，不额外装依赖：
    D:\\APP\\IndexTTS-2.0\\.venv\\Scripts\\python.exe engine\\server.py

环境变量：
    INDEXTTS_CODE_DIR   代码目录，默认 D:\\APP\\IndexTTS-2.0
    INDEXTTS_MODEL_DIR  权重目录，默认 S:\\AI\\IndexTTS-2.5
    VOICE_LIB           音色参考音频目录
    ENGINE_PORT         端口，默认 8290
"""

from __future__ import annotations

import os
import re
import sys
import threading
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

CODE_DIR = Path(os.environ.get("INDEXTTS_CODE_DIR", r"D:\APP\IndexTTS-2.0"))
MODEL_DIR = Path(os.environ.get("INDEXTTS_MODEL_DIR", r"S:\AI\IndexTTS-2.5"))
VOICE_LIB = Path(
    os.environ.get("VOICE_LIB")
    or (Path(__file__).resolve().parent.parent / "voices")
)
OUT_DIR = Path(__file__).resolve().parent / "outputs"
OUT_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="声栞 Engine", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_tts = None
_tts_lock = threading.Lock()


def gpu_info():
    try:
        import torch

        if torch.cuda.is_available():
            free, total = torch.cuda.mem_get_info()
            total_gb = total / 1024**3
            free_gb = min(free, total) / 1024**3
            return {
                "name": torch.cuda.get_device_name(0),
                "free_gb": round(free_gb, 1),
                "used_gb": round(total_gb - free_gb, 1),
                "total_gb": round(total_gb, 1),
            }
    except Exception:
        pass
    return None


def load_tts():
    global _tts
    if _tts is not None:
        return _tts
    with _tts_lock:
        if _tts is not None:
            return _tts

        if not (MODEL_DIR / "config.yaml").is_file():
            raise RuntimeError(f"模型目录缺少 config.yaml: {MODEL_DIR}")

        sys.path.insert(0, str(CODE_DIR))
        os.chdir(str(CODE_DIR))

        from indextts.infer_v2_5 import IndexTTS2

        _tts = IndexTTS2(
            cfg_path=str(MODEL_DIR / "config.yaml"),
            model_dir=str(MODEL_DIR),
            use_bf16=True,
        )
        return _tts


@app.get("/health")
def health():
    return {
        "ok": True,
        "engine": "indextts-2.5",
        "code_dir": str(CODE_DIR),
        "model_dir": str(MODEL_DIR),
        "model_loaded": _tts is not None,
        "gpu": gpu_info(),
    }


@app.get("/v1/voices")
def list_voices(q: Optional[str] = None):
    items = []
    if VOICE_LIB.is_dir():
        for p in VOICE_LIB.rglob("*.wav"):
            name = p.stem
            if q and q.lower() not in name.lower():
                continue
            items.append(
                {
                    "name": name,
                    "path": str(p),
                    "category": p.parent.name,
                    "size": p.stat().st_size,
                }
            )
    items.sort(key=lambda x: x["name"])
    return {"voices": items, "count": len(items)}


@app.get("/v1/voice-audio")
def voice_audio(path: str):
    p = Path(path).resolve()
    try:
        p.relative_to(VOICE_LIB.resolve())
    except ValueError:
        raise HTTPException(403, "只允许读取音色库目录")
    if not p.is_file():
        raise HTTPException(404, "not found")
    return FileResponse(p, media_type="audio/wav")


class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = None
    lang: str = "ZH"
    emo_vector: Optional[list[float]] = None
    emo_alpha: float = 0.8
    speed: float = 1.0
    emo_text: Optional[str] = None


@app.post("/v1/tts")
def synthesize(req: TTSRequest):
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "text 不能为空")
    if not req.voice or not Path(req.voice).is_file():
        raise HTTPException(400, "voice 必须是存在的参考音频路径")

    try:
        tts = load_tts()
    except Exception as e:
        raise HTTPException(500, f"模型加载失败: {e}")

    out = OUT_DIR / f"{uuid.uuid4().hex}.wav"
    kwargs = {
        "spk_audio_prompt": req.voice,
        "text": text,
        "lang": req.lang,
        "output_path": str(out),
        "verbose": True,
    }
    if req.emo_vector:
        kwargs["emo_vector"] = req.emo_vector
        kwargs["emo_alpha"] = req.emo_alpha
        kwargs["use_random"] = False
    if req.emo_text:
        kwargs["use_emo_text"] = True
        kwargs["emo_text"] = req.emo_text
    speed = max(0.5, min(2.0, float(req.speed or 1.0)))
    if abs(speed - 1.0) > 0.01:
        kwargs["duration_factor"] = 1.0 / speed

    try:
        tts.infer(**kwargs)
    except Exception as e:
        raise HTTPException(500, f"合成失败: {e}")

    return {"ok": True, "file": str(out), "url": f"/v1/audio/{out.name}"}


@app.get("/v1/audio/{name}")
def audio(name: str):
    p = OUT_DIR / name
    if not p.is_file():
        raise HTTPException(404, "not found")
    media = "audio/wav"
    if name.endswith(".srt"):
        media = "text/plain; charset=utf-8"
    elif name.endswith(".zip"):
        media = "application/zip"
    elif name.endswith(".mp3"):
        media = "audio/mpeg"
    return FileResponse(p, media_type=media)


class SplitRequest(BaseModel):
    text: str
    max_chars: int = 150


QUOTE_RE = re.compile(r"“([^”]*)”|「([^」]*)」|『([^』]*)』|\"([^\"]*)\"")
SPEECH_VERB = r"说|道|问|答|喊|叫|笑道|低声|开口|回答|补充|嘀咕|嘟囔"
NAME_BEFORE_RE = re.compile(rf"([\u4e00-\u9fa5]{{2,4}})\s*(?:{SPEECH_VERB})\s*[：:]?\s*$")
NAME_COLON_RE = re.compile(r"([\u4e00-\u9fa5]{2,4})\s*[：:]\s*$")
NAME_AFTER_RE = re.compile(rf"^([\u4e00-\u9fa5]{{2,4}})\s*(?:{SPEECH_VERB})")
BAD_NAMES = {
    "他", "她", "它", "我", "你", "您", "我们", "他们", "她们", "这个", "那个",
    "什么", "自己", "旁白", "未知", "声音", "时候", "地方", "东西",
}
BAD_START = set("他她它我你您咱这那其此谁每各某有没不别要会能可是在把被让给对从到跟与为以而但却并且或者所因虽如若由忽突又还也都就才只很太更最再已曾正刚快慢轻重低大小多少好坏看听想说问答喊笑走跑站坐躺拿放伸转抬压装帮替叫变完起停回过出进上下拉来去声音话语心眼嘴脸头身口脚日月天年时分秒含随神先见作后面人己哑指一道")
BAD_END = set("的了着得地过来去下上里外中前后边旁处时候刻然么呢吧啊呀哦嗯声音话语心眼嘴脸头身口脚笔神住惑愣瞪愿笑道问喊回走站坐看听想起开关停成变完掉好坏快慢轻重高低大小多少一二三四五六七八九十百千万两几个位名条只件张次遍点分秒天年月日时主茬步先带装跟含随他她它我你您咱们没又就苦洞解吼常台")


def is_name_shape(name: str) -> bool:
    if not name or not re.fullmatch(r"[\u4e00-\u9fa5]{2,4}", name):
        return False
    if name in BAD_NAMES:
        return False
    if name[0] in BAD_START or name[-1] in BAD_END:
        return False
    if name[0] == name[1]:
        return False
    return True


def name_before(text: str):
    flat = text.replace("\n", "")[-30:]
    m = NAME_BEFORE_RE.search(flat)
    if m and is_name_shape(m.group(1)):
        return m.group(1)
    m = NAME_COLON_RE.search(flat)
    if m and is_name_shape(m.group(1)):
        return m.group(1)
    return ""


def name_after(text: str):
    head = re.sub(r"^[\s，,。；;：:、]+", "", text)
    m = NAME_AFTER_RE.match(head)
    if m and is_name_shape(m.group(1)):
        return m.group(1)
    m = re.match(r"^([\u4e00-\u9fa5]{2,4})\s*[：:]", head)
    if m and is_name_shape(m.group(1)):
        return m.group(1)
    return ""


def split_block(block: str, paragraph: int = 1):
    segments = []
    pos = 0
    for m in QUOTE_RE.finditer(block):
        quote = next((g for g in m.groups() if g is not None), "").strip()
        before = block[pos:m.start()]
        after = block[m.end():]
        b = before.strip()
        a = after.strip()
        a_head = re.sub(r"^[，,。；;：:、]+", "", a)
        speech = bool(re.search(rf"(?:{SPEECH_VERB})\s*[，,：:]?\s*$", b)) or bool(
            re.match(rf"^[\u4e00-\u9fa5]{{2,4}}\s*(?:{SPEECH_VERB})", a_head)
        ) or bool(re.match(rf"^[他她它我你您]\s*(?:{SPEECH_VERB})", a_head))
        ends = bool(re.search(r"[。！？!?…]$", b))
        continues = bool(re.match(r"^[的之者等地得，,、；;：:）)】\]》」』]", a))
        inline = (not speech) and bool(quote) and (
            (not b and continues) or (bool(b) and len(quote) <= 20 and not ends)
        )
        if inline:
            continue

        before_text = b.strip(" ，。；\n\t")
        if before_text:
            segments.append(
                {"speaker": "旁白", "text": before_text, "emotion": "平静", "confidence": 0.95, "paragraph": paragraph}
            )

        speaker = name_before(before) or name_after(after) or "未知"
        if quote:
            segments.append(
                {
                    "speaker": speaker,
                    "text": quote,
                    "emotion": "平静",
                    "confidence": 0.9 if speaker != "未知" else 0.45,
                    "paragraph": paragraph,
                }
            )
        pos = m.end()

    rest = block[pos:].strip(" ，。；\n\t")
    if rest:
        segments.append(
            {"speaker": "旁白", "text": rest, "emotion": "平静", "confidence": 0.95, "paragraph": paragraph}
        )
    return segments


@app.post("/v1/split")
def split(req: SplitRequest):
    text = req.text.strip()
    if not text:
        return {"segments": [], "count": 0}

    segments = []
    for paragraph, block in enumerate(re.split(r"\n\s*\n", text), 1):
        block = block.strip()
        if not block:
            continue
        segments.extend(split_block(block, paragraph))

    return {
        "segments": segments,
        "count": len(segments),
        "characters": len(text),
        "mode": "rules",
    }


class MergeRequest(BaseModel):
    files: list[str]
    pauses: list[float] = []
    output_name: Optional[str] = None


@app.post("/v1/merge")
def merge(req: MergeRequest):
    if not req.files:
        raise HTTPException(400, "files 不能为空")

    import numpy as np
    import soundfile as sf

    chunks = []
    sr = None

    for i, name in enumerate(req.files):
        fname = name.rsplit("/", 1)[-1]
        p = OUT_DIR / fname
        if not p.is_file():
            raise HTTPException(404, f"找不到音频: {name}")
        data, sample_rate = sf.read(str(p))
        if sr is None:
            sr = sample_rate
        elif sample_rate != sr:
            raise HTTPException(400, f"采样率不一致: {sample_rate} != {sr}")
        chunks.append(data)
        if i < len(req.pauses):
            pause = max(0.0, float(req.pauses[i]))
            if pause > 0:
                chunks.append(np.zeros(int(sr * pause), dtype=data.dtype))

    merged = np.concatenate(chunks)
    out_name = req.output_name or f"merge-{uuid.uuid4().hex[:8]}.wav"
    if not out_name.endswith(".wav"):
        out_name += ".wav"
    out_path = OUT_DIR / out_name
    sf.write(str(out_path), merged, sr)

    return {
        "ok": True,
        "file": str(out_path),
        "url": f"/v1/audio/{out_name}",
        "duration": round(len(merged) / sr, 2),
        "sample_rate": sr,
    }


class ExportLine(BaseModel):
    file: str
    speaker: str
    text: str


class ExportRequest(BaseModel):
    lines: list[ExportLine]
    pauses: list[float] = []
    loudness: float = -16.0
    formats: list[str] = ["wav", "srt", "stems"]
    output_name: Optional[str] = None


def _resample(data, sr_from, sr_to):
    if sr_from == sr_to:
        return data
    import numpy as np

    n = int(len(data) * sr_to / sr_from)
    x = np.linspace(0, 1, len(data), endpoint=False)
    x2 = np.linspace(0, 1, n, endpoint=False)
    return np.interp(x2, x, data)


def _normalize(data, target_db=-16.0):
    import numpy as np

    rms = float(np.sqrt(np.mean(data**2)))
    if rms <= 1e-8:
        return data
    target = 10 ** (target_db / 20)
    gain = target / rms
    peak = float(np.max(np.abs(data)))
    if peak * gain > 0.98:
        gain = 0.98 / peak
    return data * gain


def _srt_time(seconds):
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


@app.post("/v1/export")
def export(req: ExportRequest):
    if not req.lines:
        raise HTTPException(400, "lines 不能为空")

    import numpy as np
    import soundfile as sf

    base = (req.output_name or f"export-{uuid.uuid4().hex[:8]}").replace("/", "_").replace("\\", "_")
    target_sr = 24000

    clips = []
    for line in req.lines:
        fname = line.file.rsplit("/", 1)[-1]
        p = OUT_DIR / fname
        if not p.is_file():
            raise HTTPException(404, f"找不到音频: {line.file}")
        data, sr = sf.read(str(p))
        if data.ndim > 1:
            data = data.mean(axis=1)
        data = _resample(data, sr, target_sr)
        clips.append(
            {"data": np.asarray(data, dtype="float32"), "speaker": line.speaker, "text": line.text}
        )

    chunks = []
    srt_entries = []
    cursor = 0.0

    for i, clip in enumerate(clips):
        chunks.append(clip["data"])
        dur = len(clip["data"]) / target_sr
        srt_entries.append((cursor, cursor + dur, clip["text"]))
        cursor += dur
        if i < len(req.pauses):
            pause = max(0.0, float(req.pauses[i]))
            if pause > 0:
                chunks.append(np.zeros(int(target_sr * pause), dtype="float32"))
                cursor += pause

    master = _normalize(np.concatenate(chunks), req.loudness)
    wav_path = OUT_DIR / f"{base}.wav"
    sf.write(str(wav_path), master, target_sr)

    files = {"wav": f"/v1/audio/{wav_path.name}"}

    if "srt" in req.formats:
        rows = []
        for idx, (start, end, text) in enumerate(srt_entries, 1):
            rows.append(f"{idx}\n{_srt_time(start)} --> {_srt_time(end)}\n{text}\n")
        srt_path = OUT_DIR / f"{base}.srt"
        srt_path.write_text("\n".join(rows), encoding="utf-8")
        files["srt"] = f"/v1/audio/{srt_path.name}"

    if "stems" in req.formats:
        import zipfile

        speakers = []
        for clip in clips:
            if clip["speaker"] not in speakers:
                speakers.append(clip["speaker"])

        stem_dir = OUT_DIR / f"{base}-stems"
        stem_dir.mkdir(exist_ok=True)

        for spk in speakers:
            parts = []
            for clip in clips:
                if clip["speaker"] == spk:
                    parts.append(clip["data"])
                    parts.append(np.zeros(int(target_sr * 0.25), dtype="float32"))
            stem = _normalize(np.concatenate(parts), req.loudness)
            sf.write(str(stem_dir / f"{spk}.wav"), stem, target_sr)

        zip_path = OUT_DIR / f"{base}-stems.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in stem_dir.glob("*.wav"):
                zf.write(f, f.name)

        files["stems"] = f"/v1/audio/{zip_path.name}"

    return {
        "ok": True,
        "base": base,
        "files": files,
        "file": str(wav_path),
        "duration": round(len(master) / target_sr, 2),
        "lines": len(clips),
    }


class ZipRequest(BaseModel):
    files: list[str]
    output_name: Optional[str] = None


@app.post("/v1/zip")
def zip_audio(req: ZipRequest):
    if not req.files:
        raise HTTPException(400, "files 不能为空")
    base = (req.output_name or f"bundle-{uuid.uuid4().hex[:8]}").replace("/", "_").replace("\\", "_")
    zip_path = OUT_DIR / f"{base}.zip"
    import zipfile

    count = 0
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in req.files:
            p = OUT_DIR / Path(str(name)).name
            if p.is_file():
                zf.write(p, p.name)
                count += 1
    if not count:
        raise HTTPException(400, "没有可打包的音频")
    return {
        "ok": True,
        "file": str(zip_path),
        "url": f"/v1/audio/{zip_path.name}",
        "count": count,
    }


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("ENGINE_PORT", "8290"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
