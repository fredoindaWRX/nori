#pragma once
#include "attention.hpp"
#include "tensor_math.hpp"
#include <cstdint>

namespace norama {
struct BlockConfig {
    std::size_t query_heads, kv_heads, head_width, feed_forward_width;
    std::size_t rotary_width = 0; // Zero selects the full head width; split-half pairing.
    float epsilon = 1e-5f;
    double rotary_base = 10000;
    bool rotary_interleaved = false;
    std::vector<float> rotary_factors; // Optional positive divisor per frequency pair.
};

// Row-major projection matrices. This baseline implements standard transformer math;
// it is not a trained Nori model or a claim of a novel architecture.
struct BlockWeights {
    std::vector<float> attention_norm, query, key, value, attention_output;
    std::vector<float> feed_forward_norm, gate, up, down;
};

inline void require_finite(const std::vector<float>& values) {
    for (float value : values)
        if (!std::isfinite(value)) throw std::invalid_argument("nonfinite block tensor");
}

inline void rotate_positions(std::vector<float>& tensor, std::size_t tokens, std::size_t heads,
                             std::size_t width, std::size_t rotary_width, double base,
                             std::uint64_t first_position = 0, bool interleaved=false,
                             const std::vector<float>& factors={}) {
    if (tensor.size()!=tensor_elements(tokens,heads,width) || !rotary_width || rotary_width%2 ||
        rotary_width>width || !std::isfinite(base) || base<=1 ||
        first_position>std::numeric_limits<std::uint64_t>::max()-(tokens-1))
        throw std::invalid_argument("invalid rotary dimensions, base or position");
    require_finite(tensor);
    if(!factors.empty() && factors.size()!=rotary_width/2)
        throw std::invalid_argument("rotary factor dimensions mismatch");
    for(auto factor:factors) if(!std::isfinite(factor) || factor<=0)
        throw std::invalid_argument("invalid rotary frequency factor");
    for (std::size_t token=0; token<tokens; ++token) {
        for (std::size_t head=0; head<heads; ++head) {
            const auto start=(token*heads+head)*width;
            for (std::size_t pair=0; pair<rotary_width/2; ++pair) {
                const double angle=double(first_position+token)/
                    (std::pow(base,2.0*pair/rotary_width)*(factors.empty() ? 1.0 : factors[pair]));
                const double cosine=std::cos(angle), sine=std::sin(angle);
                const auto a=interleaved ? pair*2 : pair;
                const auto b=interleaved ? pair*2+1 : pair+rotary_width/2;
                const float x=tensor[start+a], y=tensor[start+b];
                tensor[start+a]=float(x*cosine-y*sine);
                tensor[start+b]=float(x*sine+y*cosine);
            }
        }
    }
}

inline float silu(float value) {
    if (!std::isfinite(value)) throw std::invalid_argument("nonfinite activation input");
    if (value>=0) return float(double(value)/(1+std::exp(-double(value))));
    const double exponential=std::exp(double(value));
    return float(double(value)*exponential/(1+exponential));
}

struct CpuReference {
    std::vector<float> multiply(const std::vector<float>& matrix, std::size_t rows,
                                const std::vector<float>& input) const { return matvec(matrix,rows,input); }
    std::vector<float> normalize(const std::vector<float>& input, const std::vector<float>& weights,
                                 float epsilon) const { return rms_norm(input,weights,epsilon); }
    std::vector<float> attention(const std::vector<float>& q, const std::vector<float>& k,
                                 const std::vector<float>& v, std::size_t tokens,
                                 std::size_t heads, std::size_t kv, std::size_t width) const {
        return causal_attention(q,k,v,tokens,heads,kv,width);
    }
};

inline void validate_block(const BlockConfig& config, const BlockWeights& weights) {
    const auto model_width=tensor_elements(1,config.query_heads,config.head_width);
    const auto kv_width=tensor_elements(1,config.kv_heads,config.head_width);
    const auto rotary=config.rotary_width ? config.rotary_width : config.head_width;
    if (config.query_heads%config.kv_heads || !config.feed_forward_width || !rotary || rotary%2 ||
        rotary>config.head_width || !std::isfinite(config.epsilon) || config.epsilon<=0 ||
        !std::isfinite(config.rotary_base) || config.rotary_base<=1)
        throw std::invalid_argument("invalid block configuration");
    if(!config.rotary_factors.empty() && config.rotary_factors.size()!=rotary/2)
        throw std::invalid_argument("block rotary factors shape mismatch");
    for(auto factor:config.rotary_factors) if(!std::isfinite(factor) || factor<=0)
        throw std::invalid_argument("invalid block rotary factor");
    const auto matrix_size=[&](std::size_t rows, std::size_t columns) { return tensor_elements(1,rows,columns); };
    const std::size_t sizes[]={model_width,matrix_size(model_width,model_width),matrix_size(kv_width,model_width),
        matrix_size(kv_width,model_width),matrix_size(model_width,model_width),model_width,
        matrix_size(config.feed_forward_width,model_width),matrix_size(config.feed_forward_width,model_width),
        matrix_size(model_width,config.feed_forward_width)};
    const std::vector<float>* tensors[]={&weights.attention_norm,&weights.query,&weights.key,&weights.value,
        &weights.attention_output,&weights.feed_forward_norm,&weights.gate,&weights.up,&weights.down};
    for (std::size_t i=0;i<9;++i) {
        if(tensors[i]->size()!=sizes[i]) throw std::invalid_argument("block weight shape mismatch");
        require_finite(*tensors[i]);
    }
}

// Full-sequence prefill prototype. GPU backend executes projections/norm/attention;
// orchestration, rotary embedding, activation and residual addition remain on CPU.
// Repeated weight transfers are intentional for correctness bring-up, not a fast final runtime.
template<class Backend>
std::vector<float> forward_block(const Backend& backend, const BlockConfig& config,
                                 const BlockWeights& weights, const std::vector<float>& input,
                                 std::size_t tokens, std::uint64_t first_position=0) {
    validate_block(config,weights);
    const auto model_width=tensor_elements(1,config.query_heads,config.head_width);
    const auto kv_width=tensor_elements(1,config.kv_heads,config.head_width);
    if(input.size()!=tensor_elements(tokens,config.query_heads,config.head_width) ||
       first_position>std::numeric_limits<std::uint64_t>::max()-(tokens-1))
        throw std::invalid_argument("block input or position mismatch");
    require_finite(input);
    std::vector<float> query(input.size()), key(tensor_elements(tokens,config.kv_heads,config.head_width));
    std::vector<float> value(key.size());
    for(std::size_t token=0;token<tokens;++token) {
        const std::vector<float> row(input.begin()+token*model_width,input.begin()+(token+1)*model_width);
        const auto normalized=backend.normalize(row,weights.attention_norm,config.epsilon);
        const auto q=backend.multiply(weights.query,model_width,normalized);
        const auto k=backend.multiply(weights.key,kv_width,normalized);
        const auto v=backend.multiply(weights.value,kv_width,normalized);
        std::copy(q.begin(),q.end(),query.begin()+token*model_width);
        std::copy(k.begin(),k.end(),key.begin()+token*kv_width);
        std::copy(v.begin(),v.end(),value.begin()+token*kv_width);
    }
    const auto rotary=config.rotary_width ? config.rotary_width : config.head_width;
    rotate_positions(query,tokens,config.query_heads,config.head_width,rotary,config.rotary_base,
                     first_position,config.rotary_interleaved,config.rotary_factors);
    rotate_positions(key,tokens,config.kv_heads,config.head_width,rotary,config.rotary_base,
                     first_position,config.rotary_interleaved,config.rotary_factors);
    const auto attention=backend.attention(query,key,value,tokens,config.query_heads,config.kv_heads,config.head_width);
    auto output=input;
    for(std::size_t token=0;token<tokens;++token) {
        const std::vector<float> attended(attention.begin()+token*model_width,attention.begin()+(token+1)*model_width);
        const auto projected=backend.multiply(weights.attention_output,model_width,attended);
        std::vector<float> row(model_width);
        for(std::size_t i=0;i<model_width;++i) row[i]=output[token*model_width+i]+projected[i];
        require_finite(row);
        const auto normalized=backend.normalize(row,weights.feed_forward_norm,config.epsilon);
        auto gate=backend.multiply(weights.gate,config.feed_forward_width,normalized);
        const auto up=backend.multiply(weights.up,config.feed_forward_width,normalized);
        for(std::size_t i=0;i<gate.size();++i) gate[i]=silu(gate[i])*up[i];
        require_finite(gate);
        const auto down=backend.multiply(weights.down,model_width,gate);
        for(std::size_t i=0;i<model_width;++i) output[token*model_width+i]=row[i]+down[i];
    }
    require_finite(output);
    return output;
}
}
