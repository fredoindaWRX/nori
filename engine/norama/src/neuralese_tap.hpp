#pragma once
#ifndef NORI_EXPERIMENTAL_NEURALESE
#error Neuralese is only available in an explicitly experimental build
#endif
#include <vector>
#include <string>
#include <cmath>
#include <stdexcept>
#include <cstddef>
#include <atomic>

namespace norama::experimental {
// Exact live/high-water bytes of instrumented Norama cudaMalloc allocations,
// not driver/context/other-process VRAM. Single-process experiment only.
inline std::atomic<std::size_t> live_gpu_bytes{0},peak_gpu_bytes{0};
inline void allocated(std::size_t bytes) {
    const auto live=live_gpu_bytes.fetch_add(bytes)+bytes;
    auto peak=peak_gpu_bytes.load();
    while(peak<live && !peak_gpu_bytes.compare_exchange_weak(peak,live)) {}
}
inline void released(std::size_t bytes) {live_gpu_bytes.fetch_sub(bytes);}
// Exactly one final-token, post-output-norm hidden representation. Never logits.
// Source is a GPU allocation; this diagnostic snapshot owns its bounded RAM copy.
struct NeuraleseVectorSnapshot {
    unsigned schema_version=1;
    std::string model_id,layer="final_output_norm",dtype="float32",device;
    std::size_t token_index=0,hidden_size=0;
    double norm=0;
    std::vector<float> vector;
};
class VectorTap {
public:
    static constexpr std::size_t maximum_hidden_size=8192;
    VectorTap(bool enabled,std::string model_id,std::size_t token_index,std::size_t bound=maximum_hidden_size)
        :enabled_(enabled),model_id_(std::move(model_id)),index_(token_index),bound_(bound) {}
    void validate(std::size_t width,std::size_t tokens) const {
        if(!enabled_) throw std::invalid_argument("experimental vector tap is disabled");
        if(captured_ || tokens!=1 || !width || !bound_ || bound_>maximum_hidden_size || width>bound_ ||
           model_id_.empty() || model_id_.size()>128 || model_id_.find_first_of("\r\n")!=std::string::npos)
            throw std::invalid_argument("experimental vector tap bounds/one-shot contract");
    }
    // Implemented beside CUDA ownership code. No borrowed device pointer escapes.
    void capture_device(const float* values,std::size_t width,int device);
    const NeuraleseVectorSnapshot& snapshot() const {
        if(!captured_) throw std::logic_error("no experimental vector snapshot");
        return snapshot_;
    }
private:
    bool enabled_,captured_=false;
    std::string model_id_;
    std::size_t index_,bound_;
    NeuraleseVectorSnapshot snapshot_;
};
}
