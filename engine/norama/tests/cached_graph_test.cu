#include "../src/resident_graph.hpp"
#include <iostream>
#include <chrono>
#include <charconv>
void require(bool x) {if(!x) throw std::runtime_error("cached graph assertion failed");}
template<class F>void rejects(F f){bool caught=false;try{f();}catch(const std::exception&){caught=true;}require(caught);}
float compare(const std::vector<float>& a,const std::vector<float>& b,float tolerance) {
    require(a.size()==b.size());float error=0;
    for(std::size_t i=0;i<a.size();++i) error=std::max(error,std::abs(a[i]-b[i]));
    require(error<tolerance);require(norama::greedy_token(a)==norama::greedy_token(b));return error;
}
int main(int argc,char** argv) {
    try {
        if(argc<2) throw std::runtime_error("usage: cached-graph-test MODEL [token IDs]");
        std::vector<std::uint32_t> context={0,1,4};const bool actual=argc>2;
        if(actual) {
            context.clear();
            for(int i=2;i<argc;++i) {
                const std::string raw=argv[i];std::uint32_t token=0;auto p=std::from_chars(raw.data(),raw.data()+raw.size(),token);
                if(p.ec!=std::errc() || p.ptr!=raw.data()+raw.size()) throw std::runtime_error("invalid test token ID");
                context.push_back(token);
            }
        }
        norama::GgufFile file(argv[1]);norama::GpuEngine gpu;norama::ResidentGraph graph(file,gpu);
        norama::CheckpointGraph reference(file);const auto tolerance=actual ? 1e-3f : 1e-5f;
        const auto capacity=context.size()+4;
        auto session=graph.create_session(capacity),other=graph.create_session(capacity);
        auto start=std::chrono::steady_clock::now();auto scores=graph.append(session,context);
        std::cout<<"cached_prefill_seconds="<<std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count()
            <<" session_cache_bytes="<<session.cache_bytes()<<'\n';
        float worst=compare(scores,graph.logits(context),tolerance);
        if(!actual) worst=std::max(worst,compare(scores,reference.logits(norama::CpuReference{},context),tolerance));
        auto other_context=context;std::reverse(other_context.begin(),other_context.end());
        auto other_scores=graph.append(other,other_context);
        worst=std::max(worst,compare(other_scores,graph.logits(other_context),tolerance));
        for(unsigned step=0;step<3;++step) {
            const auto next=norama::greedy_token(scores);
            const auto before=session.token_count();unsigned polls=0;
            // Poll4 occurs after layer1 staged its KV suffix (including for one-layer fixture variants).
            rejects([&]{graph.append(session,{next},[&]{return ++polls==4;});});
            require(session.token_count()==before);
            start=std::chrono::steady_clock::now();scores=graph.append(session,{next});
            const auto seconds=std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count();
            context.push_back(next);start=std::chrono::steady_clock::now();auto full=graph.logits(context);
            const auto full_seconds=std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count();
            worst=std::max(worst,compare(scores,full,tolerance));
            if(!actual) worst=std::max(worst,compare(scores,reference.logits(norama::CpuReference{},context),tolerance));
            std::cout<<"step="<<step+1<<" appended="<<next<<" next="<<norama::greedy_token(scores)
                <<" cached_seconds="<<seconds<<" full_seconds="<<full_seconds<<'\n';
            require(other.token_count()==other_context.size());
        }
        require(session.token_count()==context.size());
        const auto before=session.token_count();rejects([&]{graph.append(session,{});});
        rejects([&]{graph.append(session,{std::uint32_t(reference.vocabulary_size())});});
        rejects([&]{graph.append(session,std::vector<std::uint32_t>(capacity+1,0));});
        require(session.token_count()==before);
        graph.reset(session);require(session.token_count()==0);
        worst=std::max(worst,compare(graph.append(session,context),graph.logits(context),tolerance));
        // Moved-session use and a foreign model identity fail; state cannot bleed between graphs.
        auto moved=std::move(session);rejects([&]{graph.append(session,{0});});
        require(moved.token_count()==context.size());
        if(!actual) {norama::ResidentGraph foreign(file,gpu);rejects([&]{foreign.append(moved,{0});});}
        const auto free=gpu.available_bytes();unsigned polls=0;
        rejects([&]{graph.create_session(capacity,256ull*1024*1024,[&]{return ++polls==2;});});
        require(gpu.available_bytes()>=free);
        rejects([&]{graph.create_session(capacity,1);});rejects([&]{graph.create_session(0);});
        auto bounded=graph.create_session(1);graph.append(bounded,{0});rejects([&]{graph.append(bounded,{0});});
        auto chunks=graph.create_session(context.size());
        for(std::size_t first=0;first<context.size();first+=2) {
            const auto end=std::min(context.size(),first+2);
            worst=std::max(worst,compare(graph.append(chunks,std::vector<std::uint32_t>(context.begin()+first,context.begin()+end)),
                graph.logits(std::vector<std::uint32_t>(context.begin(),context.begin()+end)),tolerance));
        }
        std::cout<<"Cached graph: CPU/stateless prefix equivalence,isolated sessions,chunked prefill,transactional cancellation/reset/moves/budgets pass; max_logit_error="<<worst<<'\n';
        return 0;
    }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}
}
