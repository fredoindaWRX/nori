#pragma once
#include <cuda_runtime.h>
#include <math_constants.h>

namespace norama {
// One 256-thread block per (query token, query head), dynamic shared memory:
// (tokens + prefix_tokens + 256) floats. Queries are a suffix; keys/values include
// the committed prefix. prefix_tokens=0 retains the original full-prefill contract.
static __global__ void causal_attention_f32(const float* query, const float* key, const float* value,
                                     float* output, int tokens, int query_heads,
                                     int kv_heads, int width, int prefix_tokens=0) {
    extern __shared__ float scratch[];
    float* scores = scratch;
    float* reduction = scratch + tokens + prefix_tokens;
    const int token = blockIdx.x / query_heads;
    const int head = blockIdx.x % query_heads;
    const int kv_head = head / (query_heads / kv_heads);
    const std::size_t q_start = (std::size_t(token) * query_heads + head) * width;
    const float scale = rsqrtf(float(width));
    float maximum = -CUDART_INF_F;
    for (int previous = threadIdx.x; previous <= token + prefix_tokens; previous += 256) {
        const std::size_t k_start = (std::size_t(previous) * kv_heads + kv_head) * width;
        float dot = 0;
        for (int channel = 0; channel < width; ++channel)
            dot += query[q_start + channel] * key[k_start + channel];
        scores[previous] = dot * scale;
        maximum = fmaxf(maximum, scores[previous]);
    }
    reduction[threadIdx.x] = maximum;
    __syncthreads();
    for (int stride = 128; stride; stride /= 2) {
        if (threadIdx.x < stride)
            reduction[threadIdx.x] = fmaxf(reduction[threadIdx.x], reduction[threadIdx.x + stride]);
        __syncthreads();
    }
    maximum = reduction[0];
    __syncthreads(); // All threads must read maximum before reusing reduction.
    float total = 0;
    for (int previous = threadIdx.x; previous <= token + prefix_tokens; previous += 256) {
        scores[previous] = expf(scores[previous] - maximum);
        total += scores[previous];
    }
    reduction[threadIdx.x] = total;
    __syncthreads();
    for (int stride = 128; stride; stride /= 2) {
        if (threadIdx.x < stride) reduction[threadIdx.x] += reduction[threadIdx.x + stride];
        __syncthreads();
    }
    const float denominator = reduction[0];
    for (int channel = threadIdx.x; channel < width; channel += 256) {
        float sum = 0;
        for (int previous = 0; previous <= token + prefix_tokens; ++previous)
            sum += scores[previous] * value[(std::size_t(previous) * kv_heads + kv_head) * width + channel];
        output[q_start + channel] = sum / denominator;
    }
}
}
