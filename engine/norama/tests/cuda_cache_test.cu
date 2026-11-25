#include "../src/gpu_engine.hpp"
#include "../src/attention.hpp"
#include <iostream>
#include <functional>
void require(bool x) {if(!x) throw std::runtime_error("GPU cache assertion failed");}
void rejects(const std::function<void()>& f) {bool caught=false;try{f();}catch(const std::exception&){caught=true;}require(caught);}
int main() {
    try {
        norama::GpuEngine gpu;float worst=0;
        for(const auto shape:{std::vector<int>{1,4,2,1},{7,4,4,17},{13,8,1,33},{257,4,2,17},{3,4,2,513}}) {
            const std::size_t tokens=shape[0],heads=shape[1],kv=shape[2],width=shape[3];
            std::vector<float> q(tokens*heads*width),k(tokens*kv*width),v(k.size());
            for(std::size_t i=0;i<q.size();++i) q[i]=float(int(i%23)-11)/13;
            for(std::size_t i=0;i<k.size();++i){k[i]=float(int(i%17)-8)/11;v[i]=float(int(i%31)-15)/19;}
            const auto expected=norama::causal_attention(q,k,v,tokens,heads,kv,width);
            auto cache=gpu.create_cache(tokens,kv,width);
            for(std::size_t first=0;first<tokens;) {
                const auto count=std::min(tokens-first,first==0 ? std::size_t(1) : first==1 ? std::size_t(7) : std::size_t(128));
                const auto slice=[&](const std::vector<float>& data,std::size_t stride) {
                    return std::vector<float>(data.begin()+first*stride,data.begin()+(first+count)*stride);
                };
                const auto actual=gpu.attention_cached(cache,slice(q,heads*width),slice(k,kv*width),slice(v,kv*width),heads);
                for(std::size_t i=0;i<actual.size();++i) worst=std::max(worst,std::abs(actual[i]-expected[first*heads*width+i]));
                first+=count;require(cache.token_count()==first);
            }
            require(worst<2e-5);
            rejects([&]{gpu.attention_cached(cache,std::vector<float>(heads*width),std::vector<float>(kv*width),std::vector<float>(kv*width),heads);});
            require(cache.token_count()==tokens);
            cache.truncate(0);require(cache.token_count()==0);cache.clear();
            auto moved=std::move(cache);rejects([&]{gpu.attention_cached(cache,{0},{0},{0},1);});
            require(moved.token_count()==0);
        }
        auto cache=gpu.create_cache(3,1,1);
        require(gpu.attention_cached(cache,{1000},{1000},{7},1)==std::vector<float>{7});
        require(gpu.attention_cached(cache,{1000},{-1000},{99},1)==std::vector<float>{7});
        const auto before=cache.token_count();
        rejects([&]{gpu.attention_cached(cache,{NAN},{1},{2},1);});
        rejects([&]{gpu.attention_cached(cache,{1},{1},{INFINITY},1);});
        rejects([&]{gpu.attention_cached(cache,{1,2},{1},{2},1);});
        rejects([&]{cache.truncate(3);});require(cache.token_count()==before);
        cache.truncate(1);
        require(gpu.attention_cached(cache,{0},{0},{9},1)==std::vector<float>{8});
        cache.clear();require(cache.token_count()==0);
        require(gpu.attention_cached(cache,{0},{0},{99},1)==std::vector<float>{99});
        rejects([&]{gpu.create_cache(0,1,1);});rejects([&]{gpu.create_cache(8193,1,1);});
        rejects([&]{gpu.create_cache(8192,1024,65536);});
        std::cout<<"GPU KV cache: MHA/MQA/GQA,chunked suffix causal reference,257-token reduction,stable softmax,overflow/nonfinite rejection,rollback/reset/moves pass; error="<<worst<<'\n';
        return 0;
    }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}
}
