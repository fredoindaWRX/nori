#include "checkpoint_graph.hpp"
#include "gpu_engine.hpp"
#include "tokenizer.hpp"
#include "resident_graph.hpp"
#include <charconv>
#include <chrono>
#include <iostream>
#include <io.h>
#include <fcntl.h>

// Standalone own-engine correctness CLI. Not a server or the installed assistant.
int wmain(int argc,wchar_t** argv) {
    try {
        if(_setmode(_fileno(stdout),_O_BINARY)==-1) throw std::runtime_error("cannot set byte-exact output");
        if(argc<4 || argc>6) throw std::runtime_error("usage: norama-generate MODEL MAX_NEW_TOKENS TEXT [--plain] [--resident]");
        const auto arg=[](const wchar_t* value){return norama::utf8(reinterpret_cast<const char16_t*>(value),std::wcslen(value));};
        const auto bound=arg(argv[2]);unsigned limit=0;
        const auto parsed=std::from_chars(bound.data(),bound.data()+bound.size(),limit);
        if(parsed.ec!=std::errc() || parsed.ptr!=bound.data()+bound.size() || !limit || limit>16)
            throw std::runtime_error("generation bound must be1..16");
        bool plain=false,resident=false;
        for(int i=4;i<argc;++i) {
            const auto option=arg(argv[i]);
            if(option=="--plain" && !plain) plain=true;
            else if(option=="--resident" && !resident) resident=true;
            else throw std::runtime_error("unknown generation option or duplicate");
        }
        norama::GgufFile file(arg(argv[1]));norama::GgufTokenizer tokenizer(file);norama::CheckpointGraph graph(file);
        const auto input=arg(argv[3]);
        auto context=plain ? tokenizer.encode(input,true) : tokenizer.chat_prompt({{"user",input}});
        if(context.size()>128) throw std::runtime_error("correctness CLI prompt exceeds128 tokens; efficient prefill pending");
        norama::GpuEngine gpu;std::vector<std::uint32_t> output;
        const auto start=std::chrono::steady_clock::now();
        std::unique_ptr<norama::ResidentGraph> loaded;
        if(resident) {
            loaded=std::make_unique<norama::ResidentGraph>(file,gpu);
            std::cerr<<"resident_bytes="<<loaded->resident_bytes()<<" load_seconds="
                <<std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count()<<'\n';
        }
        const auto inference_start=std::chrono::steady_clock::now();
        std::unique_ptr<norama::CachedSession> session;
        if(loaded) {
            session=std::make_unique<norama::CachedSession>(loaded->create_session(context.size()+limit));
            std::cerr<<"session_cache_bytes="<<session->cache_bytes()<<'\n';
        }
        for(unsigned step=0;step<limit;++step) {
            const auto scores=loaded ? loaded->append(*session,step==0 ? context : std::vector<std::uint32_t>{context.back()})
                : graph.logits(gpu,context);
            const auto next=norama::greedy_token(scores);
            std::cerr<<"step="<<step+1<<" token="<<next<<'\n';
            if(tokenizer.is_stop(next)) break;
            context.push_back(next);output.push_back(next);
        }
        std::cout<<tokenizer.decode_text(output);
        std::cerr<<"\nOwn-engine bounded generation: output_tokens="<<output.size()<<" elapsed_seconds="
                 <<std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count()
                 <<" inference_seconds="<<std::chrono::duration<double>(std::chrono::steady_clock::now()-inference_start).count()
                 <<"; imported weights,not trained Nori or production runtime\n";
        return 0;
    }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}
