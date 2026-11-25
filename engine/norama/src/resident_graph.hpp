#pragma once
#include "checkpoint_graph.hpp"
#include "gpu_engine.hpp"
#include <map>

namespace norama {
class CachedSession {
public:
    CachedSession(CachedSession&&) noexcept=default;
    CachedSession& operator=(CachedSession&&) noexcept=default;
    CachedSession(const CachedSession&)=delete;
    CachedSession& operator=(const CachedSession&)=delete;
    std::size_t token_count() const {return count_;}
    std::size_t capacity() const {return capacity_;}
    std::size_t cache_bytes() const {return cache_bytes_;}
private:
    std::weak_ptr<const int> owner_;
    std::vector<GpuKVCache> layers_;
    std::size_t count_=0,capacity_=0,cache_bytes_=0;
    bool failed_=false;
    CachedSession(const std::shared_ptr<const int>& owner,std::size_t capacity,std::size_t bytes)
        :owner_(owner),capacity_(capacity),cache_bytes_(bytes) {}
    friend class ResidentGraph;
};
// Single-owner synchronous model, isolated device KV state for each admitted session.
// Reuses the exact existing shape/metadata preflight rather than defining another schema.
class ResidentGraph {
public:
    ResidentGraph(GgufFile& file,const GpuEngine& gpu,std::size_t budget=8ull*1024*1024*1024,
                  const std::function<bool()>& cancelled={}) :file_(file),gpu_(gpu),plan_(file) {
        if(!budget || budget>8ull*1024*1024*1024) throw std::invalid_argument("resident model budget outside limits");
        std::size_t bytes=0;
        for(const auto& tensor:file_.tensors) if(tensor.dimensions.size()==2) {
            if(tensor.bytes>budget-bytes) throw std::runtime_error("model exceeds resident GPU budget");
            bytes+=static_cast<std::size_t>(tensor.bytes);
        }
        const auto free=gpu_.available_bytes();
        if(free<512ull*1024*1024 || bytes>free-512ull*1024*1024)
            throw std::runtime_error("insufficient whole-model GPU residency budget");
        for(const auto& tensor:file_.tensors) {
            checkpoint(cancelled);
            if(tensor.dimensions.size()==2) {
                auto value=gpu_.upload_matrix(std::size_t(tensor.dimensions[1]),std::size_t(tensor.dimensions[0]),tensor.type,
                    [&](std::size_t offset,std::size_t count) {checkpoint(cancelled);return file_.read_range(tensor.name,offset,count);});
                matrices_.emplace(tensor.name,std::move(value));
            } else if(tensor.name!="rope_freqs.weight") norms_.emplace(tensor.name,file_.read_weights(tensor.name));
        }
        resident_bytes_=bytes;
    }
    std::size_t resident_bytes() const {return resident_bytes_;}
    std::vector<float> logits(const std::vector<std::uint32_t>& tokens,const std::function<bool()>& cancelled={}) {
        return forward(tokens,0,nullptr,cancelled);
    }
    CachedSession create_session(std::size_t capacity,std::size_t cache_budget=256ull*1024*1024,
                                 const std::function<bool()>& cancelled={}) const {
        const auto& c=plan_.block_config();
        if(!capacity || capacity>plan_.context_limit() || !cache_budget || cache_budget>1024ull*1024*1024)
            throw std::invalid_argument("session capacity/cache budget outside limits");
        const std::uint64_t elements=std::uint64_t(capacity)*c.kv_heads*c.head_width;
        const auto bytes=elements*8*plan_.layer_count();
        if(elements>16ull*1024*1024 || bytes>cache_budget) throw std::invalid_argument("session aggregate cache budget exceeded");
        const auto free=gpu_.available_bytes();
        if(free<512ull*1024*1024 || bytes>free-512ull*1024*1024)
            throw std::runtime_error("insufficient whole-session GPU cache budget");
        CachedSession result(owner_identity_,capacity,std::size_t(bytes));result.layers_.reserve(plan_.layer_count());
        for(std::size_t layer=0;layer<plan_.layer_count();++layer) {
            checkpoint(cancelled);result.layers_.push_back(gpu_.create_cache(capacity,c.kv_heads,c.head_width));
        }
        checkpoint(cancelled);return result;
    }
    std::vector<float> append(CachedSession& session,const std::vector<std::uint32_t>& tokens,
                              const std::function<bool()>& cancelled={}) const {
        validate_session(session);
        if(tokens.empty() || tokens.size()>128 || tokens.size()>session.capacity_-session.count_)
            throw std::invalid_argument("session append context capacity exceeded or empty");
        const auto before=session.count_;
        try {
            auto scores=forward(tokens,before,&session.layers_,cancelled);
            checkpoint(cancelled); // Nothing becomes committed until the complete graph succeeds.
            session.count_+=tokens.size();return scores;
        } catch(...) {
            // Each layer writes only a suffix. Discard all staged logical lengths atomically.
            for(auto& cache:session.layers_) {
                try{cache.truncate(before);}catch(...){session.failed_=true;}
            }
            throw;
        }
    }
    void reset(CachedSession& session) const {
        validate_session(session);
        try {
            for(auto& cache:session.layers_) cache.clear();
            session.count_=0;
        } catch(...) {session.failed_=true;throw;} // Partial reset may not be reused.
    }
#ifdef NORI_EXPERIMENTAL_NEURALESE
    std::size_t experimental_hidden_size() const {return plan_.model_width();}
    std::size_t experimental_layer_count() const {return plan_.layer_count();}
    std::size_t experimental_vocabulary_size() const {return plan_.vocabulary_size();}
    // These entry points do not sample or decode tokens. One snapshot at most.
    std::vector<float> experimental_tokens(CachedSession& session,const std::vector<std::uint32_t>& tokens,
        experimental::VectorTap& tap,bool project_logits=false) const {
        return experimental_append(session,tokens,nullptr,tap,project_logits);
    }
    std::vector<float> experimental_latent(CachedSession& session,const std::vector<float>& latent,
        experimental::VectorTap& tap,bool project_logits=true) const {
        return experimental_append(session,{},&latent,tap,project_logits);
    }
#endif
private:
    std::vector<float> forward(const std::vector<std::uint32_t>& tokens,std::size_t first_position,
                               std::vector<GpuKVCache>* caches,const std::function<bool()>& cancelled
#ifdef NORI_EXPERIMENTAL_NEURALESE
                               ,const std::vector<float>* latent=nullptr,experimental::VectorTap* tap=nullptr,
                               bool project_logits=true
#endif
                               ) const {
        const auto width=plan_.model_width();const auto& c=plan_.block_config();
        const auto count=
#ifdef NORI_EXPERIMENTAL_NEURALESE
            latent ? std::size_t(1) :
#endif
            tokens.size();
        if(!count || count>128 || first_position>plan_.context_limit() ||
           count>plan_.context_limit()-first_position ||
           count>16ull*1024*1024/width) throw std::invalid_argument("resident context/activation limit");
        for(auto token:tokens) if(token>=plan_.vocabulary_size()) throw std::invalid_argument("resident token outside vocabulary");
        checkpoint(cancelled);
        auto hidden=
#ifdef NORI_EXPERIMENTAL_NEURALESE
            latent ? *latent :
#endif
            gpu_.embedding_rows(matrices_.at("token_embd.weight"),tokens);
        const auto rotary=c.rotary_width ? c.rotary_width : c.head_width;
        for(std::size_t layer=0;layer<plan_.layer_count();++layer) {
            checkpoint(cancelled);const auto p="blk."+std::to_string(layer)+".";
            auto normal=gpu_.normalize_batch(hidden,norms_.at(p+"attn_norm.weight"),c.epsilon,count);
            auto q=gpu_.multiply(matrices_.at(p+"attn_q.weight"),normal,count);
            auto k=gpu_.multiply(matrices_.at(p+"attn_k.weight"),normal,count);
            auto v=gpu_.multiply(matrices_.at(p+"attn_v.weight"),normal,count);
            rotate_positions(q,count,c.query_heads,c.head_width,rotary,c.rotary_base,first_position,c.rotary_interleaved,c.rotary_factors);
            rotate_positions(k,count,c.kv_heads,c.head_width,rotary,c.rotary_base,first_position,c.rotary_interleaved,c.rotary_factors);
            auto attended=caches ? gpu_.attention_cached(caches->at(layer),q,k,v,c.query_heads)
                : gpu_.attention(q,k,v,count,c.query_heads,c.kv_heads,c.head_width);
            auto projected=gpu_.multiply(matrices_.at(p+"attn_output.weight"),attended,count);
            for(std::size_t i=0;i<hidden.size();++i) hidden[i]+=projected[i];
            normal=gpu_.normalize_batch(hidden,norms_.at(p+"ffn_norm.weight"),c.epsilon,count);
            auto gate=gpu_.multiply(matrices_.at(p+"ffn_gate.weight"),normal,count);
            auto up=gpu_.multiply(matrices_.at(p+"ffn_up.weight"),normal,count);
            for(std::size_t i=0;i<gate.size();++i) gate[i]=silu(gate[i])*up[i];
            auto down=gpu_.multiply(matrices_.at(p+"ffn_down.weight"),gate,count);
            for(std::size_t i=0;i<hidden.size();++i) hidden[i]+=down[i];
            require_finite(hidden);
        }
        checkpoint(cancelled);
        const std::vector<float> last(hidden.end()-width,hidden.end());
        const auto normalized=
#ifdef NORI_EXPERIMENTAL_NEURALESE
            tap ? gpu_.normalize_batch_tapped(last,norms_.at("output_norm.weight"),c.epsilon,*tap) :
#endif
            gpu_.normalize_batch(last,norms_.at("output_norm.weight"),c.epsilon,1);
#ifdef NORI_EXPERIMENTAL_NEURALESE
        if(!project_logits) return {};
#endif
        return gpu_.multiply(matrices_.at(plan_.output_tensor()),normalized);
    }
#ifdef NORI_EXPERIMENTAL_NEURALESE
    std::vector<float> experimental_append(CachedSession& session,const std::vector<std::uint32_t>& tokens,
        const std::vector<float>* latent,experimental::VectorTap& tap,bool project_logits) const {
        validate_session(session);tap.validate(plan_.model_width(),1);
        const auto count=latent ? std::size_t(1) : tokens.size();
        if(!count || count>128 || count>session.capacity_-session.count_)
            throw std::invalid_argument("experimental append capacity/batch limit");
        if(latent) {
            if(!tokens.empty() || latent->size()!=plan_.model_width())
                throw std::invalid_argument("experimental latent dimension mismatch");
            require_finite(*latent);
        }
        const auto before=session.count_;
        try {
            auto scores=forward(tokens,before,&session.layers_,{},latent,&tap,project_logits);
            session.count_+=count;return scores;
        } catch(...) {
            for(auto& cache:session.layers_) {
                try{cache.truncate(before);}catch(...){session.failed_=true;}
            }
            throw;
        }
    }
#endif
    GgufFile& file_;const GpuEngine& gpu_;CheckpointGraph plan_;
    std::map<std::string,ResidentMatrix> matrices_;
    std::map<std::string,std::vector<float>> norms_;
    std::size_t resident_bytes_=0;
    std::shared_ptr<const int> owner_identity_=std::make_shared<const int>(0);
    void validate_session(const CachedSession& session) const {
        if(session.owner_.lock()!=owner_identity_ || session.failed_ || session.layers_.size()!=plan_.layer_count() ||
           session.count_>session.capacity_) throw std::invalid_argument("invalid,failed or foreign model session");
        for(const auto& cache:session.layers_) if(cache.token_count()!=session.count_)
            throw std::invalid_argument("inconsistent session cache lengths");
    }
    static void checkpoint(const std::function<bool()>& cancelled) {
        if(cancelled && cancelled()) throw std::runtime_error("resident execution cancelled");
    }
};
}
