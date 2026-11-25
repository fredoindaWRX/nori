// Compiled WITHOUT NORI_EXPERIMENTAL_NEURALESE. Exact ordinary token path.
#ifdef NORI_EXPERIMENTAL_NEURALESE
#error Baseline must be built with Neuralese disabled
#endif
#include "../../engine/norama/src/resident_graph.hpp"
#include "../../engine/norama/src/tokenizer.hpp"
#include <iostream>
int wmain(int argc,wchar_t** argv) {
    try {
        if(argc!=3) throw std::runtime_error("usage: baseline MODEL PROMPT");
        auto utf=[](const wchar_t* p){return norama::utf8(reinterpret_cast<const char16_t*>(p),std::wcslen(p));};
        norama::GgufFile file(utf(argv[1]));norama::GgufTokenizer tokenizer(file);
        norama::GpuEngine gpu;norama::ResidentGraph graph(file,gpu);
        auto tokens=tokenizer.encode(utf(argv[2]),true);
        auto session=graph.create_session(tokens.size()+8);auto scores=graph.append(session,tokens);
        std::cout<<"{\"experimental_compiled\":false,\"final_token_ids\":[";
        for(unsigned step=0;step<4;++step) {
            const auto next=norama::greedy_token(scores);
            if(tokenizer.is_stop(next)) break;
            if(step) std::cout<<',';std::cout<<next;
            if(step<3) scores=graph.append(session,{next});
        }
        std::cout<<"]}\n";return 0;
    }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}
}
