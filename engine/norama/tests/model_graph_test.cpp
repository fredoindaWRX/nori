#include "block_fixture.hpp"
#include "../src/model_graph.hpp"
#include <iostream>

template<class Action> static void rejects(Action action) {
    try { action(); } catch(const std::invalid_argument&) { return; }
    throw std::runtime_error("invalid model request accepted");
}
int main() {
    try {
        norama::CpuReference cpu;
        norama::ModelGraph model{norama::BlockConfig{1,1,2,2},3};
        model.context_limit=4;
        model.embedding={1,0,0,1,1,1};
        model.output_norm={1,1};
        model.layers={block_fixture(model.block)};
        auto logits=norama::next_token_logits(cpu,model,{0,1});
        const double expected=1/std::sqrt(0.50001);
        if(logits.size()!=3 || logits[0]!=0 || std::abs(logits[1]-expected)>1e-6 ||
           std::abs(logits[2]-expected)>1e-6 || norama::greedy_token(logits)!=1)
            throw std::runtime_error("tied model logits or tie-breaking mismatch");
        model.output_head={2,0,0,3,4,5};
        logits=norama::next_token_logits(cpu,model,{1});
        if(logits[0]!=0 || std::abs(logits[1]-3*expected)>1e-6 ||
           std::abs(logits[2]-5*expected)>1e-6 || norama::greedy_token(logits)!=2)
            throw std::runtime_error("untied model head mismatch");
        rejects([&]{norama::next_token_logits(cpu,model,{});});
        rejects([&]{norama::next_token_logits(cpu,model,{3});});
        rejects([&]{norama::next_token_logits(cpu,model,{0,0,0,0,0});});
        rejects([&]{norama::greedy_token({});});
        auto broken=model; broken.layers.clear();
        rejects([&]{norama::next_token_logits(cpu,broken,{0});});
        broken=model; broken.embedding.pop_back();
        rejects([&]{norama::next_token_logits(cpu,broken,{0});});
        std::cout << "Norama.cpp analytic token-to-logits, tied/untied heads and model validation passed\n";
    } catch(const std::exception& error) {std::cerr << error.what() << '\n';return 1;}
}
