# models/

Local ASR model files go here. They are **not** committed to the repo.

- Windows (whisper.cpp): `ggml-base.en.bin` (default), `ggml-tiny.en.bin`, `ggml-small.en.bin`.
- Android (sherpa-onnx): streaming model files; whisper.cpp fallback.

If a required model is missing, ColdVoice shows setup instructions and never falls back to
any cloud service.
