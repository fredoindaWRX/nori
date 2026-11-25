#include "block_fixture.hpp"
#include <iostream>

static void near(float actual, double expected) {
    if(!std::isfinite(actual) || std::abs(actual-expected)>2e-6) throw std::runtime_error("analytic block mismatch");
}
int main() {
    try {
        norama::CpuReference cpu;
        const norama::BlockConfig config{1,1,2,2};
        auto weights=block_fixture(config);
        const std::vector<float> input{3,4,1,2};
        if(norama::forward_block(cpu,config,weights,input,2)!=input)
            throw std::runtime_error("zero branches changed residual");
        weights.value=weights.attention_output={1,0,0,1};
        auto output=norama::forward_block(cpu,config,weights,{3,4},1);
        near(output[0],3+3/std::sqrt(12.50001)); near(output[1],4+4/std::sqrt(12.50001));
        weights=block_fixture(config);
        weights.gate=weights.up=weights.down={1,0,0,1};
        output=norama::forward_block(cpu,config,weights,{3,4},1);
        for(int i=0;i<2;++i) {
            const double x=double(i==0 ? 3:4)/std::sqrt(12.50001);
            near(output[i],double(i==0 ? 3:4)+x*x/(1+std::exp(-x)));
        }
        std::vector<float> rotary{1,0,1,0};
        norama::rotate_positions(rotary,2,1,2,2,10000);
        near(rotary[0],1); near(rotary[1],0); near(rotary[2],std::cos(1.0)); near(rotary[3],std::sin(1.0));
        near(norama::silu(1000),1000); near(norama::silu(-1000),0);
        bool rejected=false;
        weights.down.pop_back();
        try { norama::forward_block(cpu,config,weights,{3,4},1); }
        catch(const std::invalid_argument&) { rejected=true; }
        if(!rejected) throw std::runtime_error("bad block weights accepted");
        rejected=false;
        try { norama::rotate_positions(rotary,2,1,2,2,10000,std::numeric_limits<std::uint64_t>::max()); }
        catch(const std::invalid_argument&) { rejected=true; }
        if(!rejected) throw std::runtime_error("overflowing positions accepted");
        std::cout << "Norama.cpp analytic residual/attention/feed-forward/rotary and block validation passed\n";
    } catch(const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
