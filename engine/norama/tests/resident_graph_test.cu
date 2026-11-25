#include "../src/resident_graph.hpp"
#include <iostream>
#include <chrono>
void require(bool x) {if(!x) throw std::runtime_error("resident graph test failed");}
template<class Action> void rejects(Action action) {bool caught=false;try{action();}catch(const std::exception&){caught=true;}require(caught);}
int main(int argc,char** argv) {
    try {
        if(argc<2) throw std::runtime_error("usage: resident-graph-test MODEL [token IDs]");
        norama::GgufFile file(argv[1]);norama::CheckpointGraph reference(file);norama::GpuEngine gpu;
        std::vector<std::uint32_t> tokens={0,1,4};
        const bool actual=argc>2;
        if(actual) {tokens.clear();for(int i=2;i<argc;++i) tokens.push_back(std::uint32_t(std::stoul(argv[i])));}
        auto start=std::chrono::steady_clock::now();
        norama::ResidentGraph graph(file,gpu);
        std::cout<<"resident_bytes="<<graph.resident_bytes()<<" load_seconds="
            <<std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count()<<'\n';
        start=std::chrono::steady_clock::now();auto scores=graph.logits(tokens);
        std::cout<<"resident_forward_seconds="<<std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count()<<'\n';
        start=std::chrono::steady_clock::now();auto old=actual ? reference.logits(gpu,tokens) : reference.logits(norama::CpuReference{},tokens);
        std::cout<<"reference_forward_seconds="<<std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count()<<'\n';
        require(scores.size()==old.size());float maximum=0;
        for(std::size_t i=0;i<scores.size();++i) maximum=std::max(maximum,std::abs(scores[i]-old[i]));
        require(maximum<(actual ? 0.01f : 1e-5f));
        require(norama::greedy_token(scores)==norama::greedy_token(old));
        rejects([&]{graph.logits({});});rejects([&]{graph.logits({std::uint32_t(reference.vocabulary_size())});});
        rejects([&]{graph.logits(tokens,[]{return true;});});
        unsigned polls=0;rejects([&]{graph.logits(tokens,[&]{return ++polls==3;});});
        start=std::chrono::steady_clock::now();require(graph.logits(tokens)==scores);
        std::cout<<"resident_repeat_seconds="<<std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count()<<'\n';
        rejects([&]{norama::ResidentGraph bad(file,gpu,1);});
        rejects([&]{norama::ResidentGraph bad(file,gpu,8ull*1024*1024*1024,[]{return true;});});
        const auto free_before=gpu.available_bytes();polls=0;
        rejects([&]{norama::ResidentGraph bad(file,gpu,8ull*1024*1024*1024,[&]{return ++polls==8;});});
        require(gpu.available_bytes()>=free_before);
        std::cout<<"Resident graph reference/cancellation/reuse pass; greedy="<<norama::greedy_token(scores)<<" max_logit_error="<<maximum<<'\n';
        return 0;
    }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}
}
