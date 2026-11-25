#include "../../engine/norama/src/resident_graph.hpp"
#include "../../engine/norama/src/tokenizer.hpp"
#include <cuda_runtime.h>
#include <windows.h>
#include <psapi.h>
#include <chrono>
#include <iostream>
#include <iomanip>
#include <limits>
#include <io.h>
#include <fcntl.h>

namespace {
using Clock=std::chrono::steady_clock;
double seconds(Clock::time_point start) {return std::chrono::duration<double>(Clock::now()-start).count();}
void require(bool good,const char* message) {if(!good) throw std::runtime_error(message);}
template<class F> void rejects(F action) {bool caught=false;try{action();}catch(const std::exception&){caught=true;}require(caught,"malformed request accepted");}
void write_vector(const wchar_t* path,const std::vector<float>& values) {
    require(!values.empty() && values.size()<=8192,"vector write bound");
    HANDLE file=CreateFileW(path,GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);
    require(file!=INVALID_HANDLE_VALUE,"vector file exists or cannot be created; preserved");
    DWORD written=0;const auto bytes=DWORD(values.size()*sizeof(float));
    const bool okay=WriteFile(file,values.data(),bytes,&written,nullptr) && written==bytes && FlushFileBuffers(file);
    CloseHandle(file);require(okay,"vector write failed");
}
}
int wmain(int argc,wchar_t** argv) {
    try {
        require(_setmode(_fileno(stdout),_O_BINARY)!=-1,"byte output failed");
        require(argc==6,"usage: probe MODEL baseline|capture|recurrence|selftest PROMPT NEW_VECTOR_PATH --experimental-neuralese");
        auto utf=[](const wchar_t* p){return norama::utf8(reinterpret_cast<const char16_t*>(p),std::wcslen(p));};
        require(utf(argv[5])=="--experimental-neuralese","experiment flag required");
        const auto mode=utf(argv[2]);
        require(mode=="baseline" || mode=="capture" || mode=="recurrence" || mode=="selftest","unknown experiment mode");
        norama::GgufFile file(utf(argv[1]));norama::GgufTokenizer tokenizer(file);norama::CheckpointGraph plan(file);
        const auto input=tokenizer.encode(utf(argv[3]),true);
        require(!input.empty() && input.size()<=128,"experiment prompt bound 1..128 tokens");
        norama::GpuEngine gpu;
        const auto before=gpu.available_bytes();const auto start=Clock::now();
        std::vector<float> captured;std::vector<std::uint32_t> decoded;
        norama::experimental::NeuraleseVectorSnapshot selected_snapshot;
        double load=0,ttft=0,latency=0,capture_seconds=0,cycle_seconds=0,decode_seconds=0;
        std::size_t cycle=0;bool regression=false,bounds=false;
        {
            norama::ResidentGraph graph(file,gpu);load=seconds(start);
            auto session=graph.create_session(input.size()+8);
            const auto inference=Clock::now();std::vector<float> scores;
            if(mode=="baseline") scores=graph.append(session,input);
            else {
                norama::experimental::VectorTap tap(true,"llama3.2-3b-instruct",input.size()-1);
                const auto tap_start=Clock::now();
                scores=graph.experimental_tokens(session,input,tap,mode!="recurrence");
                capture_seconds=seconds(tap_start);selected_snapshot=tap.snapshot();captured=selected_snapshot.vector;cycle=1;
                require(captured.size()==plan.model_width(),"real hidden dimension mismatch");
                require(tap.snapshot().device=="cuda:0","unexpected vector source");
                if(mode=="selftest") {
                    auto baseline=graph.create_session(input.size()+8);
                    regression=graph.append(baseline,input)==scores;
                    require(regression,"tap changed baseline logits");
                    rejects([&]{graph.experimental_tokens(session,{0},tap);});
                    norama::experimental::VectorTap disabled(false,"test",0),too_small(true,"test",0,1);
                    rejects([&]{graph.experimental_tokens(session,{0},disabled);});
                    rejects([&]{graph.experimental_tokens(session,{0},too_small);});
                    norama::experimental::VectorTap oversized(true,"test",0,8193);
                    rejects([&]{graph.experimental_tokens(session,{0},oversized);});
                    norama::experimental::VectorTap wrong(true,"test",0);
                    rejects([&]{graph.experimental_latent(session,{1.0f},wrong);});
                    auto invalid=captured;invalid[0]=std::numeric_limits<float>::infinity();
                    rejects([&]{graph.experimental_latent(session,invalid,wrong);});
                    bounds=true;
                }
                if(mode=="recurrence") {
                    require(scores.empty(),"cycle 1 projected logits unexpectedly");
                    const auto second=Clock::now();
                    norama::experimental::VectorTap next(true,"llama3.2-3b-instruct",input.size());
                    // Identity recurrence. No invented/trainable adapter or intermediate token/text.
                    scores=graph.experimental_latent(session,captured,next,true);
                    cycle_seconds=seconds(second);selected_snapshot=next.snapshot();captured=selected_snapshot.vector;cycle=2;
                    require(session.token_count()==input.size()+1,"second latent pass did not commit");
                }
            }
            const auto sampling=Clock::now();
            for(unsigned step=0;step<4;++step) {
                const auto next=norama::greedy_token(scores);
                if(step==0) ttft=seconds(inference);
                if(tokenizer.is_stop(next)) break;
                decoded.push_back(next);
                if(step<3) scores=graph.append(session,{next});
            }
            decode_seconds=seconds(sampling);latency=seconds(inference);
        }
        require(norama::experimental::live_gpu_bytes.load()==0,"Norama GPU allocations leaked");
        const auto after=gpu.available_bytes();
        PROCESS_MEMORY_COUNTERS memory{};memory.cb=sizeof(memory);
        require(GetProcessMemoryInfo(GetCurrentProcess(),&memory,sizeof(memory)),"RAM accounting failed");
        if(!captured.empty()) write_vector(argv[4],captured);
        // Only decode after the second pass in recurrence mode. Token IDs below are final output.
        const auto text=tokenizer.decode_text(decoded);
        std::cout<<std::setprecision(17)<<"{\"mode\":\""<<mode<<"\",\"hidden_size\":"<<plan.model_width()
            <<",\"layers\":"<<plan.layer_count()<<",\"vocabulary\":"<<plan.vocabulary_size()
            <<",\"query_heads\":"<<plan.block_config().query_heads<<",\"kv_heads\":"<<plan.block_config().kv_heads
            <<",\"head_width\":"<<plan.block_config().head_width<<",\"feed_forward_width\":"<<plan.block_config().feed_forward_width
            <<",\"prompt_tokens\":"<<input.size()<<",\"cycle\":"<<cycle<<",\"output_tokens\":"<<decoded.size()
            <<",\"load_seconds\":"<<load<<",\"ttft_seconds\":"<<ttft<<",\"latency_seconds\":"<<latency
            <<",\"first_pass_seconds\":"<<capture_seconds<<",\"cycle_2_seconds\":"<<cycle_seconds
            <<",\"decode_seconds\":"<<decode_seconds<<",\"tokens_per_second\":"<<(decode_seconds>0 && decoded.size()>1 ? (decoded.size()-1)/decode_seconds : 0)
            <<",\"peak_owned_cuda_bytes\":"<<norama::experimental::peak_gpu_bytes.load()
            <<",\"live_owned_cuda_bytes_after\":0,\"cuda_free_before\":"<<before<<",\"cuda_free_after\":"<<after
            <<",\"peak_ram_working_set_bytes\":"<<memory.PeakWorkingSetSize
            <<",\"regression_exact_logits\":"<<(regression?"true":"false")<<",\"malformed_bounds_checked\":"<<(bounds?"true":"false")
            <<",\"intermediate_text_generated\":false,\"final_decoded_bytes\":"<<text.size()<<",\"final_token_ids\":[";
        for(std::size_t i=0;i<decoded.size();++i) std::cout<<(i?",":"")<<decoded[i];
        std::cout<<"],\"snapshot\":";
        if(captured.empty()) std::cout<<"null";
        else std::cout<<"{\"schema_version\":"<<selected_snapshot.schema_version
            <<",\"model_id\":\""<<selected_snapshot.model_id<<"\",\"layer\":\""<<selected_snapshot.layer
            <<"\",\"token_index\":"<<selected_snapshot.token_index<<",\"hidden_size\":"<<selected_snapshot.hidden_size
            <<",\"dtype\":\""<<selected_snapshot.dtype<<"\",\"device\":\""<<selected_snapshot.device
            <<"\",\"norm\":"<<selected_snapshot.norm<<",\"vector_format\":\"little-endian float32 binary\"}";
        std::cout<<"}\n";return 0;
    }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}
