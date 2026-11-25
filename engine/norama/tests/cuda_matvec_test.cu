#include <cuda_runtime.h>
#include "../src/tensor_math.hpp"
#include "../src/cuda_matvec.cuh"
#include <iostream>

static void checked(cudaError_t error) {
    if (error != cudaSuccess) throw std::runtime_error(cudaGetErrorString(error));
}

int main() {
    float *matrix = nullptr, *vector = nullptr, *output = nullptr;
    try {
        cudaDeviceProp device{};
        checked(cudaGetDeviceProperties(&device, 0));
        constexpr int rows = 257, columns = 513;
        std::vector<float> host_matrix(rows * columns), host_vector(columns);
        for (std::size_t i = 0; i < host_matrix.size(); ++i) host_matrix[i] = float(int(i % 29) - 14) / 17;
        for (std::size_t i = 0; i < host_vector.size(); ++i) host_vector[i] = float(int(i % 13) - 6) / 11;
        checked(cudaMalloc(&matrix, host_matrix.size() * sizeof(float)));
        checked(cudaMalloc(&vector, host_vector.size() * sizeof(float)));
        checked(cudaMalloc(&output, columns * sizeof(float)));
        checked(cudaMemcpy(matrix, host_matrix.data(), host_matrix.size() * sizeof(float), cudaMemcpyHostToDevice));
        checked(cudaMemcpy(vector, host_vector.data(), host_vector.size() * sizeof(float), cudaMemcpyHostToDevice));
        norama::matvec_f32<<<(rows + 31) / 32, 32>>>(matrix, vector, output, rows, columns);
        checked(cudaGetLastError());
        checked(cudaDeviceSynchronize());
        std::vector<float> actual(rows);
        checked(cudaMemcpy(actual.data(), output, rows * sizeof(float), cudaMemcpyDeviceToHost));
        const auto expected = norama::matvec(host_matrix, rows, host_vector);
        float max_error = 0;
        for (int i = 0; i < rows; ++i) {
            if (!std::isfinite(actual[i])) throw std::runtime_error("nonfinite GPU result");
            max_error = std::max(max_error, std::abs(actual[i] - expected[i]));
        }
        if (max_error > 1e-4f) throw std::runtime_error("GPU/CPU mismatch");
        std::vector<float> weights(columns);
        for (int i = 0; i < columns; ++i) weights[i] = float(i % 7 + 1) / 7;
        checked(cudaMemcpy(matrix, weights.data(), columns * sizeof(float), cudaMemcpyHostToDevice));
        norama::rms_norm_f32<<<1, 256>>>(vector, matrix, output, columns, 1e-5f);
        checked(cudaGetLastError());
        checked(cudaDeviceSynchronize());
        actual.resize(columns);
        checked(cudaMemcpy(actual.data(), output, columns * sizeof(float), cudaMemcpyDeviceToHost));
        const auto normalized = norama::rms_norm(host_vector, weights, 1e-5f);
        float rms_error = 0;
        for (int i = 0; i < columns; ++i) {
            if (!std::isfinite(actual[i])) throw std::runtime_error("nonfinite GPU normalization");
            rms_error = std::max(rms_error, std::abs(actual[i] - normalized[i]));
        }
        if (rms_error > 1e-5f) throw std::runtime_error("GPU RMS/CPU mismatch");
        checked(cudaFree(matrix)); matrix = nullptr;
        checked(cudaFree(vector)); vector = nullptr;
        checked(cudaFree(output)); output = nullptr;
        std::cout << "Norama.cpp independent CUDA matvec 257x513 passed on " << device.name
                  << "; matvec error=" << max_error << "; RMS error=" << rms_error << '\n';
        return 0;
    } catch (const std::exception& error) {
        if (matrix) cudaFree(matrix);
        if (vector) cudaFree(vector);
        if (output) cudaFree(output);
        std::cerr << error.what() << '\n';
        return 1;
    }
}
