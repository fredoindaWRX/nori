#include "../src/resident_graph.hpp"
#include "numerical_probe_metrics.hpp"
#include <charconv>
#include <chrono>
#include <iomanip>
#include <iostream>

// Explicit diagnostic only. No runtime/model switch, output repair or tools.
int main(int argc,char** argv) {
    try {
        if(argc<3 || argc>1027 || (std::string(argv[2])!="--fixture" && std::string(argv[2])!="--actual"))
            throw std::invalid_argument("usage: long-context-probe MODEL --fixture | --actual TOKEN_IDS (129..1024)");
        const bool actual=std::string(argv[2])=="--actual";
        std::vector<std::uint32_t> tokens;
        if(!actual) {
            if(argc!=3) throw std::invalid_argument("fixture takes no token arguments");
            for(unsigned i=0;i<257;++i) tokens.push_back((i*7+i/13)%5);
        } else {
            if(argc<132) throw std::invalid_argument("actual context must contain129..1024 tokens");
            for(int i=3;i<argc;++i) {
                const std::string raw=argv[i];std::uint32_t id=0;
                const auto parsed=std::from_chars(raw.data(),raw.data()+raw.size(),id);
                if(parsed.ec!=std::errc() || parsed.ptr!=raw.data()+raw.size())
                    throw std::invalid_argument("invalid long-context token ID");
                tokens.push_back(id);
            }
        }
        const auto start=std::chrono::steady_clock::now();
        const auto seconds=[&]{return std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count();};
        const auto cancelled=[&]{return seconds()>180;};
        std::cout<<std::setprecision(12);
        norama::GgufFile file(argv[1]);norama::CheckpointGraph cpu(file);norama::GpuEngine gpu;
        norama::ResidentGraph graph(file,gpu,8ull*1024*1024*1024,cancelled);
        if(tokens.size()+1>cpu.context_limit()) throw std::invalid_argument("diagnostic exceeds imported context");
        const double tolerance=actual ? 1e-3 : 1e-5;
        double worst=0;
        const auto compare=[&](const std::vector<float>& expected,const std::vector<float>& scores,const char* phase,std::size_t count){
            const auto result=norama_test::compare_logits(expected,scores);
            norama_test::require_agreement(result,tolerance);worst=std::max(worst,result.max_absolute);
            std::cout<<"{\"phase\":\""<<phase<<"\",\"tokens\":"<<count<<",\"logits\":"<<result.count
                <<",\"max_absolute\":"<<result.max_absolute<<",\"rms\":"<<result.rms
                <<",\"reference_top\":"<<result.reference_top<<",\"actual_top\":"<<result.actual_top<<"}"<<std::endl;
        };
        auto baseline=graph.create_session(tokens.size()+1,256ull*1024*1024,cancelled);
        std::vector<float> scores;
        for(std::size_t first=0;first<tokens.size();first+=128) {
            const auto end=std::min(tokens.size(),first+128);
            scores=graph.append(baseline,{tokens.begin()+first,tokens.begin()+end},cancelled);
            const std::vector<std::uint32_t> prefix(tokens.begin(),tokens.begin()+end);
            if(!actual) compare(cpu.logits(norama::CpuReference{},prefix,cancelled),scores,"cpu_vs_chunked",end);
            else if(end<=128) compare(graph.logits(prefix,cancelled),scores,"stateless_vs_chunked",end);
        }
        const auto expected=scores;
        auto alternate=graph.create_session(tokens.size()+1,256ull*1024*1024,cancelled);
        auto unrelated=graph.create_session(1,256ull*1024*1024,cancelled);
        graph.append(unrelated,{tokens.back()},cancelled);
        const std::size_t schedule[]={1,127,17,64};
        std::size_t index=0;
        for(std::size_t first=0;first<tokens.size();) {
            const auto end=std::min(tokens.size(),first+schedule[index++%4]);
            scores=graph.append(alternate,{tokens.begin()+first,tokens.begin()+end},cancelled);
            first=end;
        }
        compare(expected,scores,"different_chunk_boundaries",tokens.size());
        if(unrelated.token_count()!=1 || alternate.token_count()!=tokens.size())
            throw std::runtime_error("long-context session isolation failed");
        // Deliberately cancel after every layer has staged its suffix, but before
        // logical commit. This exercises rollback on a mature multi-chunk cache.
        const auto next=std::uint32_t(norama::greedy_token(expected));unsigned polls=0;
        bool rejected=false;
        try {graph.append(alternate,{next},[&]{return cancelled() || ++polls==cpu.layer_count()+2;});}
        catch(const std::runtime_error& error) {
            if(std::string(error.what())!="resident execution cancelled") throw;
            rejected=true;
        }
        if(!rejected || alternate.token_count()!=tokens.size())
            throw std::runtime_error("long-context cancellation did not roll back");
        const auto clean=graph.append(baseline,{next},cancelled);
        compare(clean,graph.append(alternate,{next},cancelled),"rollback_then_reuse",tokens.size()+1);
        graph.reset(alternate);
        for(std::size_t first=0;first<tokens.size();first+=128) {
            const auto end=std::min(tokens.size(),first+128);
            scores=graph.append(alternate,{tokens.begin()+first,tokens.begin()+end},cancelled);
        }
        compare(expected,scores,"reset_then_prefill",tokens.size());
        std::cout<<"{\"status\":\"PASS\",\"tokens\":"<<tokens.size()<<",\"layers\":"<<cpu.layer_count()
            <<",\"max_absolute\":"<<worst<<",\"seconds\":"<<seconds()
            <<",\"cpu_full_context_reference\":"<<(actual?"false":"true")
            <<",\"external_reference\":false,\"tools_executed\":0,\"execution_authorized\":false}"<<std::endl;
        return 0;
    }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}
