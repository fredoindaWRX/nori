#include "../src/gpu_engine.hpp"
#include "../src/tensor_math.hpp"
#include <iostream>
#include <limits>

template<class Action> void rejects(Action action) {
    try { action(); } catch (const std::invalid_argument&) { return; }
    throw std::runtime_error("invalid engine request accepted");
}
int main() {
    try {
        norama::GpuEngine engine;
        if(engine.multiply({1,2,3,4,5,6},2,{2,-1,3})!=std::vector<float>{9,21})
            throw std::runtime_error("production multiply mismatch");
        auto expected=norama::rms_norm({3,4},{1,2},1e-5f);
        auto actual=engine.normalize({3,4},{1,2},1e-5f);
        for(std::size_t i=0;i<actual.size();++i)
            if(std::abs(actual[i]-expected[i])>1e-6f) throw std::runtime_error("production normalize mismatch");
        rejects([&]{engine.multiply({1},0,{1});});
        rejects([&]{engine.multiply({1},1,{});});
        rejects([&]{engine.multiply({1,2},1,{1});});
        rejects([&]{engine.normalize({1},{1},0);});
        rejects([&]{engine.normalize({1},{},1e-5f);});
        rejects([&]{engine.normalize({1},{std::numeric_limits<float>::infinity()},1e-5f);});
        rejects([&]{engine.attention({1},{1},{1},0,1,1,1);});
        rejects([&]{engine.attention({1,2,3},{1,2},{1,2},1,3,2,1);});
        rejects([&]{engine.attention({1},{1},{1},1,1,1,2);});
        rejects([&]{engine.attention({std::numeric_limits<float>::quiet_NaN()},{1},{1},1,1,1,1);});
        // Verify failed requests leave the engine usable.
        if(engine.attention({0},{0},{7},1,1,1,1)!=std::vector<float>{7})
            throw std::runtime_error("engine unusable after rejection");
        std::cout << "Norama.cpp engine API, 10 rejection cases and reuse passed on " << engine.device_name() << '\n';
    } catch(const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
