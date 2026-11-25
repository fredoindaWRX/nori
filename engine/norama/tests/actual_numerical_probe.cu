#include "../src/resident_graph.hpp"
#include "numerical_probe_metrics.hpp"
#include <charconv>
#include <chrono>
#include <iomanip>
#include <iostream>

void report(const char* phase,const norama_test::LogitComparison& result){
    std::cout<<"{\"phase\":\""<<phase<<"\",\"logits\":"<<result.count
        <<",\"max_absolute\":"<<result.max_absolute<<",\"rms\":"<<result.rms
        <<",\"cosine\":"<<result.cosine<<",\"reference_top\":"<<result.reference_top
        <<",\"actual_top\":"<<result.actual_top<<",\"reference_margin\":"<<result.reference_margin<<"}"<<std::endl;
}
int main(int argc,char** argv){
    try {
        if(argc<3 || argc>18) throw std::invalid_argument("usage: numerical-probe MODEL TOKEN_ID [TOKEN_ID ...],max16 tokens");
        std::vector<std::uint32_t> context;
        for(int i=2;i<argc;++i){
            const std::string raw=argv[i];std::uint32_t value=0;
            const auto parsed=std::from_chars(raw.data(),raw.data()+raw.size(),value);
            if(parsed.ec!=std::errc() || parsed.ptr!=raw.data()+raw.size())
                throw std::invalid_argument("invalid numerical-probe token ID");
            context.push_back(value);
        }
        std::cout<<std::setprecision(12);
        const auto start=std::chrono::steady_clock::now();
        const auto seconds=[&]{return std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count();};
        const auto deadline=[&]{return seconds()>240;};
        norama::GgufFile file(argv[1]);norama::CheckpointGraph reference(file);
        // The actual CPU decoded-layer safety limit is retained,not bypassed.
        std::cout<<"{\"phase\":\"cpu_start\",\"tokens\":"<<context.size()
            <<",\"layers\":"<<reference.layer_count()<<",\"decoded_layer_bytes\":"<<reference.decoded_layer_bytes()<<"}"<<std::endl;
        auto scores=reference.logits(norama::CpuReference{},context,deadline,[&](std::size_t layer){
            std::cout<<"{\"phase\":\"cpu_layer\",\"layer\":"<<layer<<",\"elapsed_seconds\":"<<seconds()<<"}"<<std::endl;
        });
        const auto cpu_seconds=seconds();norama::GpuEngine gpu;norama::ResidentGraph graph(file,gpu,8ull*1024*1024*1024,deadline);
        const auto resident_load_seconds=seconds()-cpu_seconds;
        const auto baseline=graph.logits(context,deadline);
        auto comparison=norama_test::compare_logits(scores,baseline);report("cpu_vs_resident",comparison);
        norama_test::require_agreement(comparison,1e-3);
        auto session=graph.create_session(context.size(),256ull*1024*1024,deadline);
        auto unrelated=graph.create_session(1,256ull*1024*1024,deadline);
        std::vector<float> cached;
        for(auto token:context){
            cached=graph.append(session,{token},deadline);
            if(unrelated.token_count()==0)graph.append(unrelated,{context.back()},deadline);
        }
        comparison=norama_test::compare_logits(scores,cached);report("cpu_vs_cached",comparison);
        norama_test::require_agreement(comparison,1e-3);
        graph.reset(session);cached=graph.append(session,context,deadline);
        comparison=norama_test::compare_logits(scores,cached);report("cpu_vs_reset",comparison);
        norama_test::require_agreement(comparison,1e-3);
        std::cout<<"{\"status\":\"PASS\",\"cpu_seconds\":"<<cpu_seconds
            <<",\"resident_load_seconds\":"<<resident_load_seconds<<",\"elapsed_seconds\":"<<seconds()
            <<",\"tools_executed\":0,\"execution_authorized\":false,\"external_reference\":false}"<<std::endl;
        return 0;
    }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}
