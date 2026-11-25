# Fredo desktop model profile

Hardware verified from CPU-Z report and live GPU query: Ryzen 7 9800X3D, 32GB DDR5,
RTX 4080 SUPER 16GB VRAM. This is a desktop-development profile, not a universal OS requirement.

General Knights: Qwen3 8B Q4_K_M, approximately 5.2GB model download.
Neo and Morpheus: existing Qwen2.5-Coder 14B Q4_K_M, approximately 9GB model download.
All use 4096 context, up to 768 generated tokens per request, eight CPU threads.
Qwen3 defaults to non-thinking mode for responsiveness; this does not guarantee low latency.

One loaded model, one parallel inference request, queue limit 32, flash attention enabled.
The models swap rather than remaining resident together. Twelve agents can share one model;
they do not require twelve model copies. Tools can execute independently of model inference.
These are starting limits, not a hard reservation of GPU memory for games or the avatar.

Native Ollama: start-ollama.ps1 reads the environment settings from config.yaml.
An already running Ollama instance needs restarting to pick up changed settings.
Compose contains the same environment limits but remains CPU-oriented until GPU support is
configured and tested. Windows native Ollama was used for local GPU validation.

Future NORI Home/Server/Robotics installations should select a separate profile after hardware
inspection. Preserve shared agent roles, prompts, task contracts and owner identity across
profiles. Actual automatic installation-time model selection remains future integration work.

Live Trinity validation read a temporary file through its tool, then correctly totaled 30 units.
That initial two-round run took 26.33 seconds. It is functional evidence, not a throughput benchmark.
