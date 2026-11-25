#include "../src/tensor_math.hpp"
#include <iostream>
#include <limits>

int main() {
    try {
        const auto result = norama::matvec({1, 2, 3, 4, 5, 6}, 2, {2, -1, 3});
        if (result != std::vector<float>{9, 21}) throw std::runtime_error("matvec mismatch");
        const auto normalized = norama::rms_norm({3, 4}, {1, 2}, 1e-5f);
        if (std::abs(normalized[0] - 3 / std::sqrt(12.50001)) > 1e-6 ||
            std::abs(normalized[1] - 8 / std::sqrt(12.50001)) > 1e-6)
            throw std::runtime_error("RMS mismatch");
        bool rejected = false;
        try { norama::matvec({1, 2}, 2, {1, 2}); } catch (const std::invalid_argument&) { rejected = true; }
        if (!rejected) throw std::runtime_error("invalid dimensions accepted");
        rejected = false;
        try { norama::rms_norm({std::numeric_limits<float>::infinity()}, {1}, 1e-5f); }
        catch (const std::invalid_argument&) { rejected = true; }
        if (!rejected) throw std::runtime_error("nonfinite input accepted");
        std::cout << "Norama.cpp independent CPU math checks passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
