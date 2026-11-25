#pragma once
#include <cmath>
#include <stdexcept>
#include <vector>

namespace norama {
inline std::vector<float> rms_norm(const std::vector<float>& input,
                                 const std::vector<float>& weights, float epsilon) {
    if (input.empty() || input.size() != weights.size() || !std::isfinite(epsilon) || epsilon <= 0)
        throw std::invalid_argument("invalid RMS normalization dimensions or epsilon");
    double sum = 0;
    for (float value : input) {
        if (!std::isfinite(value)) throw std::invalid_argument("nonfinite RMS input");
        sum += double(value) * value;
    }
    const double scale = 1.0 / std::sqrt(sum / input.size() + epsilon);
    std::vector<float> output(input.size());
    for (std::size_t i = 0; i < input.size(); ++i) output[i] = float(input[i] * scale * weights[i]);
    return output;
}

// Row-major F32 reference kernel; optimized/quantized GPU kernels come later.
inline std::vector<float> matvec(const std::vector<float>& matrix, std::size_t rows,
                                const std::vector<float>& vector) {
    if (!rows || vector.empty() || matrix.size() / rows != vector.size() || matrix.size() % rows)
        throw std::invalid_argument("invalid matrix-vector dimensions");
    std::vector<float> output(rows);
    for (std::size_t row = 0; row < rows; ++row) {
        double sum = 0;
        for (std::size_t column = 0; column < vector.size(); ++column)
            sum += double(matrix[row * vector.size() + column]) * vector[column];
        output[row] = float(sum);
    }
    return output;
}
}
