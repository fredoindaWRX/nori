#include "../src/attention.hpp"
#include <iostream>

static void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

int main() {
    try {
        // Uniform logits give exact causal running means. Two query heads share one KV head.
        auto actual = norama::causal_attention(std::vector<float>(12, 0), std::vector<float>(6, 0),
                                             {2, 4, 6, 8, 10, 12}, 3, 2, 1, 2);
        require(actual == std::vector<float>{2,4,2,4,4,6,4,6,6,8,6,8}, "causal/GQA mean mismatch");
        // Distinct head values catch incorrect grouping, independent of reference equivalence.
        actual = norama::causal_attention(std::vector<float>(4, 0), std::vector<float>(2, 0),
                                         {3, 9}, 1, 4, 2, 1);
        require(actual == std::vector<float>{3,3,9,9}, "KV head mapping mismatch");
        actual = norama::causal_attention({1000,1000}, {1000,-1000}, {7,99}, 2, 1, 1, 1);
        require(actual == std::vector<float>{7,7}, "stable softmax mismatch");
        bool rejected = false;
        try { norama::causal_attention({1,2,3}, {1,2}, {1,2}, 1, 3, 2, 1); }
        catch (const std::invalid_argument&) { rejected = true; }
        require(rejected, "invalid head grouping accepted");
        rejected = false;
        try { norama::causal_attention({std::numeric_limits<float>::quiet_NaN()}, {1}, {1}, 1,1,1,1); }
        catch (const std::invalid_argument&) { rejected = true; }
        require(rejected, "nonfinite input accepted");
        rejected = false;
        try { norama::tensor_elements(std::numeric_limits<std::size_t>::max(), 2, 2); }
        catch (const std::invalid_argument&) { rejected = true; }
        require(rejected, "overflowing dimensions accepted");
        std::cout << "Norama.cpp CPU causal/GQA, stable softmax and validation checks passed\n";
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
