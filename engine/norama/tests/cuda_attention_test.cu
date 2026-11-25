#include "../src/attention.hpp"
#include "../src/gpu_engine.hpp"
#include <iostream>

static void checked(cudaError_t error) {
    if (error != cudaSuccess) throw std::runtime_error(cudaGetErrorString(error));
}

static float evaluate(const std::vector<float>& q, const std::vector<float>& k,
                      const std::vector<float>& v, int tokens, int q_heads, int kv_heads, int width) {
    const auto expected = norama::causal_attention(q, k, v, tokens, q_heads, kv_heads, width);
    const auto actual = norama::GpuEngine().attention(q,k,v,tokens,q_heads,kv_heads,width);
    float error = 0;
    for (std::size_t i = 0; i < actual.size(); ++i) {
        if (!std::isfinite(actual[i])) throw std::runtime_error("nonfinite CUDA attention");
        error = std::max(error, std::abs(actual[i] - expected[i]));
    }
    if (error > 2e-5f) throw std::runtime_error("GPU attention differs from CPU reference");
    return error;
}

int main() {
    try {
        float worst = 0;
        // Covers MHA, MQA and GQA; odd widths, widths > one block, and >256-token reductions.
        for (const auto shape : {std::vector<int>{1,4,2,1}, {7,4,4,17}, {13,8,1,33},
                                 {257,4,2,17}, {3,4,2,513}}) {
            const int tokens=shape[0], heads=shape[1], kv=shape[2], width=shape[3];
            std::vector<float> q(norama::tensor_elements(tokens,heads,width));
            std::vector<float> k(norama::tensor_elements(tokens,kv,width)), v(k.size());
            for (std::size_t i=0; i<q.size(); ++i) q[i]=float(int(i%23)-11)/13;
            for (std::size_t i=0; i<k.size(); ++i) { k[i]=float(int(i%17)-8)/11; v[i]=float(int(i%31)-15)/19; }
            worst=std::max(worst,evaluate(q,k,v,tokens,heads,kv,width));
        }
        worst=std::max(worst,evaluate({1000,1000},{1000,-1000},{7,99},2,1,1,1));
        // Future values must not affect earlier outputs, including with huge future logits.
        worst=std::max(worst,evaluate({1,1,1},{1,1,10000},{2,4,9000},3,1,1,1));
        cudaDeviceProp device{}; checked(cudaGetDeviceProperties(&device,0));
        std::cout << "Norama.cpp CUDA attention: 7 shapes/stability/causal cases passed on "
                  << device.name << "; max absolute error=" << worst << '\n';
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
