#include "../src/checkpoint_graph.hpp"
#include "../src/gpu_engine.hpp"
#include <charconv>
#include <chrono>
#include <iostream>

int main(int argc,char** argv) {
    try {
        if(argc<3 || argc>18) throw std::runtime_error("usage: norama-model-probe MODEL TOKEN_ID [TOKEN_ID ...],max16 tokens");
        std::vector<std::uint32_t> tokens;
        for(int i=2;i<argc;++i) {
            std::uint32_t value=0;const std::string text=argv[i];
            const auto parsed=std::from_chars(text.data(),text.data()+text.size(),value);
            if(parsed.ec!=std::errc() || parsed.ptr!=text.data()+text.size()) throw std::runtime_error("invalid token ID");
            tokens.push_back(value);
        }
        norama::GgufFile file(argv[1]);norama::CheckpointGraph graph(file);norama::GpuEngine gpu;
        const auto start=std::chrono::steady_clock::now();
        const auto scores=graph.logits(gpu,tokens,{},[&](auto layer){std::cout<<"layer="<<layer<<'/'<<graph.layer_count()<<std::endl;});
        const auto next=norama::greedy_token(scores);
        const auto seconds=std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count();
        std::cout<<"Own complete imported forward: device="<<gpu.device_name()<<" logits="<<scores.size()
                 <<" greedy_token="<<next<<" score="<<scores[next]<<" elapsed_seconds="<<seconds<<'\n';
        const auto vocabulary=file.metadata.find("tokenizer.ggml.tokens");
        if(vocabulary!=file.metadata.end() && vocabulary->second.type==9 && next<vocabulary->second.items.size())
            std::cout<<"raw_vocabulary_entry="<<vocabulary->second.items[next].text<<'\n';
        std::cout<<"Token-ID execution,not text tokenization,chat validation or a trained Nori-owned model\n";
    }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}
