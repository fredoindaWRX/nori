#pragma once
#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <vector>

namespace norama {
inline std::size_t tensor_elements(std::size_t tokens, std::size_t heads, std::size_t width) {
    if (!tokens || !heads || !width || heads > std::numeric_limits<std::size_t>::max() / width ||
        tokens > std::numeric_limits<std::size_t>::max() / (heads * width))
        throw std::invalid_argument("invalid or overflowing attention dimensions");
    return tokens * heads * width;
}

// Independent double-accumulation reference: [token, head, channel] layout.
// This is standard scaled dot-product/GQA mathematics, not a novel model architecture.
inline std::vector<float> causal_attention(const std::vector<float>& query,
                                          const std::vector<float>& key,
                                          const std::vector<float>& value,
                                          std::size_t tokens, std::size_t query_heads,
                                          std::size_t kv_heads, std::size_t width) {
    const auto q_count = tensor_elements(tokens, query_heads, width);
    const auto kv_count = tensor_elements(tokens, kv_heads, width);
    if (query_heads % kv_heads || query.size() != q_count || key.size() != kv_count ||
        value.size() != kv_count) throw std::invalid_argument("attention shape mismatch");
    for (const auto* tensor : {&query, &key, &value})
        for (float x : *tensor)
            if (!std::isfinite(x)) throw std::invalid_argument("nonfinite attention input");
    std::vector<float> output(q_count);
    std::vector<double> scores(tokens);
    const double scale = 1 / std::sqrt(double(width));
    for (std::size_t token = 0; token < tokens; ++token) {
        for (std::size_t head = 0; head < query_heads; ++head) {
            const std::size_t kv_head = head / (query_heads / kv_heads);
            const std::size_t q_start = (token * query_heads + head) * width;
            double maximum = -std::numeric_limits<double>::infinity();
            for (std::size_t previous = 0; previous <= token; ++previous) {
                const std::size_t k_start = (previous * kv_heads + kv_head) * width;
                double dot = 0;
                for (std::size_t channel = 0; channel < width; ++channel)
                    dot += double(query[q_start + channel]) * key[k_start + channel];
                scores[previous] = dot * scale;
                maximum = std::max(maximum, scores[previous]);
            }
            double denominator = 0;
            for (std::size_t previous = 0; previous <= token; ++previous) {
                scores[previous] = std::exp(scores[previous] - maximum);
                denominator += scores[previous];
            }
            for (std::size_t channel = 0; channel < width; ++channel) {
                double sum = 0;
                for (std::size_t previous = 0; previous <= token; ++previous)
                    sum += scores[previous] * value[(previous * kv_heads + kv_head) * width + channel];
                output[q_start + channel] = float(sum / denominator);
            }
        }
    }
    return output;
}
}
