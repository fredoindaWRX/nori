#include "block_fixture.hpp"
#include "../src/gpu_engine.hpp"
#include <iostream>

int main() {
    try {
        const norama::BlockConfig config{4,2,4,24};
        const auto weights=block_fixture(config,true);
        std::vector<float> input(7*16);
        for(std::size_t i=0;i<input.size();++i) input[i]=float(int(i%29)-14)/17;
        norama::CpuReference cpu;
        norama::GpuEngine gpu;
        const auto expected=norama::forward_block(cpu,config,weights,input,7);
        const auto actual=norama::forward_block(gpu,config,weights,input,7);
        float error=0;
        for(std::size_t i=0;i<actual.size();++i) error=std::max(error,std::abs(actual[i]-expected[i]));
        if(error>5e-5f) throw std::runtime_error("composed GPU block differs from CPU");
        // Prefix execution must match the full causal pass, despite nonzero attention and FF branches.
        const std::vector<float> prefix(input.begin(),input.begin()+4*16);
        const auto earlier=norama::forward_block(gpu,config,weights,prefix,4);
        for(std::size_t i=0;i<earlier.size();++i)
            if(std::abs(earlier[i]-actual[i])>5e-5f) throw std::runtime_error("future input changed earlier block outputs");
        // A second layer checks composition and residual paths, not only one-layer primitive agreement.
        const auto expected2=norama::forward_block(cpu,config,weights,expected,7);
        const auto actual2=norama::forward_block(gpu,config,weights,actual,7);
        for(std::size_t i=0;i<actual2.size();++i) error=std::max(error,std::abs(actual2[i]-expected2[i]));
        if(error>5e-5f) throw std::runtime_error("two composed GPU blocks differ from CPU");
        std::cout << "Norama.cpp composed two-layer GPU/CPU and causal prefix checks passed on "
                  << gpu.device_name() << "; max absolute error=" << error << '\n';
    } catch(const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
