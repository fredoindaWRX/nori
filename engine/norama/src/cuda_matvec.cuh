#pragma once
#include <cuda_runtime.h>

namespace norama {
// One block normalizes one vector. Launch with exactly 256 threads.
static __global__ void rms_norm_f32(const float* input, const float* weights, float* output,
                             int columns, float epsilon) {
    __shared__ float partial[256];
    input += std::size_t(blockIdx.x) * columns;
    output += std::size_t(blockIdx.x) * columns;
    float sum = 0;
    for (std::size_t i = threadIdx.x; i < std::size_t(columns); i += 256) sum += input[i] * input[i];
    partial[threadIdx.x] = sum;
    __syncthreads();
    for (int stride = 128; stride; stride /= 2) {
        if (threadIdx.x < stride) partial[threadIdx.x] += partial[threadIdx.x + stride];
        __syncthreads();
    }
    const float scale = rsqrtf(partial[0] / columns + epsilon);
    for (std::size_t i = threadIdx.x; i < std::size_t(columns); i += 256)
        output[i] = input[i] * scale * weights[i];
}
// Independent correctness-first F32 kernel. Not yet performance optimized.
static __global__ void matvec_f32(const float* matrix, const float* vector, float* output,
                          int rows, int columns) {
    const std::size_t row = std::size_t(blockIdx.x) * blockDim.x + threadIdx.x;
    if (row >= std::size_t(rows)) return;
    float sum = 0;
    for (int column = 0; column < columns; ++column)
        sum += matrix[std::size_t(row) * columns + column] * vector[column];
    output[row] = sum;
}
}
