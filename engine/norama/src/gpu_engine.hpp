#pragma once
#include <cstddef>
#include <string>
#include <vector>
#include <cstdint>
#include <functional>
#include <memory>
#ifdef NORI_EXPERIMENTAL_NEURALESE
#include "neuralese_tap.hpp"
#endif

namespace norama {
// Move-only owned allocation. A partially uploaded or invalid matrix is never published.
class ResidentMatrix {
public:
    ~ResidentMatrix();
    ResidentMatrix(ResidentMatrix&&) noexcept;
    ResidentMatrix& operator=(ResidentMatrix&&) noexcept;
    ResidentMatrix(const ResidentMatrix&)=delete;
    ResidentMatrix& operator=(const ResidentMatrix&)=delete;
    std::size_t byte_size() const;
private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
    explicit ResidentMatrix(std::unique_ptr<Impl>);
    friend class GpuEngine;
};
// One session/layer's device-resident F32 attention history. No shared conversation state.
class GpuKVCache {
public:
    ~GpuKVCache();
    GpuKVCache(GpuKVCache&&) noexcept;
    GpuKVCache& operator=(GpuKVCache&&) noexcept;
    GpuKVCache(const GpuKVCache&)=delete;
    GpuKVCache& operator=(const GpuKVCache&)=delete;
    std::size_t token_count() const;
    void truncate(std::size_t tokens);
    void clear();
private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
    explicit GpuKVCache(std::unique_ptr<Impl>);
    friend class GpuEngine;
};
// Synchronous F32 prototype API. Own CUDA implementation; no inference-library dependency.
class GpuEngine {
public:
    explicit GpuEngine(int device_index = 0);
    std::string device_name() const;
    std::vector<float> attention(const std::vector<float>& query, const std::vector<float>& key,
                                 const std::vector<float>& value, std::size_t tokens,
                                 std::size_t query_heads, std::size_t kv_heads, std::size_t width) const;
    std::vector<float> normalize(const std::vector<float>& input,
                                 const std::vector<float>& weights, float epsilon) const;
    std::vector<float> multiply(const std::vector<float>& matrix, std::size_t rows,
                                const std::vector<float>& vector) const;
    std::size_t available_bytes() const;
    ResidentMatrix upload_matrix(std::size_t rows, std::size_t columns, std::uint32_t type,
        const std::function<std::vector<unsigned char>(std::size_t,std::size_t)>& reader) const;
    std::vector<float> multiply(const ResidentMatrix& matrix, const std::vector<float>& input,
                                std::size_t tokens=1) const;
    std::vector<float> embedding_rows(const ResidentMatrix& matrix,
                                      const std::vector<std::uint32_t>& tokens) const;
    GpuKVCache create_cache(std::size_t capacity,std::size_t kv_heads,std::size_t head_width) const;
    std::vector<float> attention_cached(GpuKVCache& cache,const std::vector<float>& query,
        const std::vector<float>& key,const std::vector<float>& value,std::size_t query_heads) const;
    std::vector<float> normalize_batch(const std::vector<float>& input,
        const std::vector<float>& weights, float epsilon, std::size_t tokens) const;
#ifdef NORI_EXPERIMENTAL_NEURALESE
    std::vector<float> normalize_batch_tapped(const std::vector<float>& input,
        const std::vector<float>& weights,float epsilon,experimental::VectorTap& tap) const;
#endif
private:
    int device_index_;
};
}
