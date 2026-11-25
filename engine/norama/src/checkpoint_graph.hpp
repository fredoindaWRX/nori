#pragma once
#include "gguf_model.hpp"
#include "model_graph.hpp"
#include <functional>
#include <set>

namespace norama {
// Import adapter only. Nori's engine and future native model are not defined by
// this third-party weight schema. No external inference service/library is used.
class CheckpointGraph {
public:
    explicit CheckpointGraph(GgufFile& file):file_(file) {
        const auto& architecture=metadata("general.architecture",8);
        if(architecture.text!="llama") throw std::runtime_error("unsupported imported architecture");
        width_=integer("llama.embedding_length",65536);
        config_.query_heads=integer("llama.attention.head_count",1024);
        config_.kv_heads=integer("llama.attention.head_count_kv",1024);
        if(width_%config_.query_heads || config_.query_heads%config_.kv_heads)
            throw std::runtime_error("incompatible imported attention dimensions");
        config_.head_width=width_/config_.query_heads;
        config_.feed_forward_width=integer("llama.feed_forward_length",131072);
        config_.rotary_width=integer("llama.rope.dimension_count",config_.head_width);
        if(config_.rotary_width%2) throw std::runtime_error("odd imported rotary width");
        config_.epsilon=number("llama.attention.layer_norm_rms_epsilon");
        config_.rotary_base=number("llama.rope.freq_base");
        if(config_.epsilon<=0 || config_.rotary_base<=1) throw std::runtime_error("invalid imported normalization/rotary parameters");
        config_.rotary_interleaved=true;
        layers_=integer("llama.block_count",128);
        context_=std::min(std::size_t(8192),integer("llama.context_length",1048576));
        vocabulary_=integer("llama.vocab_size",1048576);
        if(vocabulary_<2) throw std::runtime_error("invalid imported vocabulary");
        check_optional_width("llama.attention.key_length",config_.head_width);
        check_optional_width("llama.attention.value_length",config_.head_width);
        const std::set<std::string> supported={"llama.embedding_length","llama.attention.head_count",
            "llama.attention.head_count_kv","llama.feed_forward_length","llama.rope.dimension_count",
            "llama.attention.layer_norm_rms_epsilon","llama.rope.freq_base","llama.block_count",
            "llama.context_length","llama.vocab_size","llama.attention.key_length","llama.attention.value_length"};
        // Scaling schemes not represented by explicit factors are not guessed.
        for(const auto& entry:file_.metadata)
            if(entry.first.rfind("llama.rope.scaling.",0)==0)
                throw std::runtime_error("unsupported imported rotary scaling metadata");
        for(const auto& entry:file_.metadata)
            if(entry.first.rfind("llama.",0)==0 && !supported.count(entry.first))
                throw std::runtime_error("unsupported imported execution metadata: "+entry.first);
        std::set<std::string> accepted;
        const auto expect=[&](const std::string& name,std::vector<std::uint64_t> dimensions) {
            if(file_.tensor(name).dimensions!=dimensions) throw std::runtime_error("imported tensor shape mismatch: "+name);
            accepted.insert(name);
        };
        expect("token_embd.weight",{width_,vocabulary_});
        expect("output_norm.weight",{width_});
        const auto kv=config_.kv_heads*config_.head_width, ff=config_.feed_forward_width;
        decoded_block_elements_=2*width_+2*width_*width_+2*kv*width_+3*ff*width_;
        for(std::size_t i=0;i<layers_;++i) {
            const auto p="blk."+std::to_string(i)+".";
            expect(p+"attn_norm.weight",{width_}); expect(p+"ffn_norm.weight",{width_});
            expect(p+"attn_q.weight",{width_,width_});
            expect(p+"attn_k.weight",{width_,kv}); expect(p+"attn_v.weight",{width_,kv});
            expect(p+"attn_output.weight",{width_,width_});
            expect(p+"ffn_gate.weight",{width_,ff}); expect(p+"ffn_up.weight",{width_,ff});
            expect(p+"ffn_down.weight",{ff,width_});
        }
        output_name_="token_embd.weight";
        if(has_tensor("output.weight")) { expect("output.weight",{width_,vocabulary_});output_name_="output.weight"; }
        if(has_tensor("rope_freqs.weight")) {
            expect("rope_freqs.weight",{config_.rotary_width/2});
            config_.rotary_factors=file_.read_weights("rope_freqs.weight");
            for(auto factor:config_.rotary_factors) if(factor<=0) throw std::runtime_error("invalid imported rotary factor");
        }
        for(const auto& tensor:file_.tensors) if(!accepted.count(tensor.name))
            throw std::runtime_error("unsupported imported tensor: "+tensor.name);
    }
    std::size_t layer_count() const {return layers_;}
    std::size_t vocabulary_size() const {return vocabulary_;}
    const BlockConfig& block_config() const {return config_;}
    std::size_t model_width() const {return width_;}
    std::size_t context_limit() const {return context_;}
    const std::string& output_tensor() const {return output_name_;}
    std::uint64_t decoded_layer_bytes() const {return decoded_block_elements_*sizeof(float);}
    template<class Backend>
    std::vector<float> logits(const Backend& backend,const std::vector<std::uint32_t>& tokens,
                              const std::function<bool()>& cancelled={},
                              const std::function<void(std::size_t)>& progress={}) {
        // This path materializes a complete decoded layer. ResidentGraph only
        // uses this object's validated plan, not this operation; its compressed
        // model/session budgets are enforced separately before GPU allocation.
        if(decoded_block_elements_>128ull*1024*1024) throw std::runtime_error("decoded layer exceeds 512 MiB limit");
        if(tokens.empty() || tokens.size()>context_) throw std::runtime_error("imported context limit exceeded or empty");
        if(tokens.size()>16ull*1024*1024/width_) throw std::runtime_error("imported activation budget exceeded");
        for(auto token:tokens) if(token>=vocabulary_) throw std::runtime_error("imported token outside vocabulary");
        const auto checkpoint=[&] {if(cancelled && cancelled()) throw std::runtime_error("checkpoint execution cancelled");};
        checkpoint();
        std::vector<float> hidden;hidden.reserve(tokens.size()*width_);
        for(auto token:tokens) {
            checkpoint();
            const auto row=file_.read_weights("token_embd.weight",token,1);
            hidden.insert(hidden.end(),row.begin(),row.end());
        }
        for(std::size_t i=0;i<layers_;++i) {
            checkpoint();
            const auto weights=load_block(i,checkpoint);
            hidden=forward_block(backend,config_,weights,hidden,tokens.size());
            if(progress) progress(i+1);
        }
        checkpoint();
        const std::vector<float> last(hidden.end()-width_,hidden.end());
        const auto normalized=backend.normalize(last,file_.read_weights("output_norm.weight"),config_.epsilon);
        std::vector<float> output;output.reserve(vocabulary_);
        // Tiled head avoids materializing a multi-gigabyte embedding/output matrix.
        for(std::size_t row=0;row<vocabulary_;) {
            checkpoint();
            const auto count=std::min(std::size_t(1024),vocabulary_-row);
            const auto projected=backend.multiply(file_.read_weights(output_name_,row,count),count,normalized);
            output.insert(output.end(),projected.begin(),projected.end());row+=count;
        }
        require_finite(output);return output;
    }
private:
    GgufFile& file_;
    BlockConfig config_{};
    std::size_t width_=0,layers_=0,context_=0,vocabulary_=0;
    std::uint64_t decoded_block_elements_=0;
    std::string output_name_;
    const GgufValue& metadata(const std::string& name,std::uint32_t type) const {
        const auto entry=file_.metadata.find(name);
        if(entry==file_.metadata.end() || entry->second.type!=type)
            throw std::runtime_error("missing/wrong imported metadata: "+name);
        return entry->second;
    }
    std::size_t integer(const std::string& name,std::size_t limit) const {
        const auto value=metadata(name,4).bits;
        if(!value || value>limit) throw std::runtime_error("imported metadata limit: "+name);
        return static_cast<std::size_t>(value);
    }
    float number(const std::string& name) const {
        const auto bits=static_cast<std::uint32_t>(metadata(name,6).bits);
        float value;std::memcpy(&value,&bits,4);
        if(!std::isfinite(value)) throw std::runtime_error("nonfinite imported metadata");return value;
    }
    void check_optional_width(const std::string& name,std::size_t width) const {
        if(file_.metadata.count(name) && integer(name,65536)!=width)
            throw std::runtime_error("unsupported imported key/value head width");
    }
    bool has_tensor(const std::string& name) const {
        for(const auto& tensor:file_.tensors) if(tensor.name==name) return true;return false;
    }
    std::vector<float> load_tensor(const std::string& name,const std::function<void()>& checkpoint) {
        const auto& tensor=file_.tensor(name);
        if(tensor.elements>128ull*1024*1024) throw std::runtime_error("tensor exceeds decoded512 MiB limit");
        const auto width=tensor.dimensions[0], rows=tensor.elements/width;
        const auto batch=std::min(std::uint64_t(1024),16ull*1024*1024/width);
        if(!batch) throw std::runtime_error("tensor row exceeds decoded budget");
        std::vector<float> result;result.reserve(static_cast<std::size_t>(tensor.elements));
        for(std::uint64_t row=0;row<rows;) {
            checkpoint();
            const auto count=std::min(batch,rows-row);
            auto tile=file_.read_weights(name,row,count);
            result.insert(result.end(),tile.begin(),tile.end());row+=count;
        }
        return result;
    }
    BlockWeights load_block(std::size_t index,const std::function<void()>& checkpoint) {
        const auto p="blk."+std::to_string(index)+".";
        return {load_tensor(p+"attn_norm.weight",checkpoint),load_tensor(p+"attn_q.weight",checkpoint),
                load_tensor(p+"attn_k.weight",checkpoint),load_tensor(p+"attn_v.weight",checkpoint),
                load_tensor(p+"attn_output.weight",checkpoint),load_tensor(p+"ffn_norm.weight",checkpoint),
                load_tensor(p+"ffn_gate.weight",checkpoint),load_tensor(p+"ffn_up.weight",checkpoint),load_tensor(p+"ffn_down.weight",checkpoint)};
    }
};
}
