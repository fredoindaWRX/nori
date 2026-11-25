#include "block_fixture.hpp"
#include "../src/model_graph.hpp"
#include "../src/gpu_engine.hpp"
#include <iostream>

int main() {
    try {
        norama::ModelGraph model{norama::BlockConfig{4,2,4,24},31};
        model.embedding.resize(31*16);
        for(std::size_t i=0;i<model.embedding.size();++i) model.embedding[i]=float(int(i%37)-18)/23;
        model.output_norm.assign(16,1);
        model.layers.assign(3,block_fixture(model.block,true));
        norama::CpuReference cpu;
        norama::GpuEngine gpu;
        std::vector<std::uint32_t> context{2,5,8,11,14};
        float worst=0;
        // Real autoregressive execution on synthetic weights: append each scored choice
        // and recompute the full context. This tests graph wiring, not language quality.
        for(int step=0;step<3;++step) {
            const auto expected=norama::next_token_logits(cpu,model,context);
            const auto actual=norama::next_token_logits(gpu,model,context);
            for(std::size_t i=0;i<actual.size();++i) worst=std::max(worst,std::abs(actual[i]-expected[i]));
            if(worst>1e-4f || norama::greedy_token(actual)!=norama::greedy_token(expected))
                throw std::runtime_error("GPU autoregressive graph disagrees with CPU");
            context.push_back(norama::greedy_token(actual));
        }
        std::cout << "Norama.cpp synthetic 3-layer/3-step token-to-logits GPU execution passed on "
                  << gpu.device_name() << "; max absolute error=" << worst
                  << "; not a trained language model\n";
    } catch(const std::exception& error) {std::cerr << error.what() << '\n';return 1;}
}
