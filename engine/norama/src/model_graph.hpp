#pragma once
#include "transformer_block.hpp"

namespace norama {
// Independent execution graph for the standard-math reference decoder.
// Synthetic fixtures are NOT trained models. Tokenization, checkpoint import and
// efficient incremental decoding are separate capabilities, not implied here.
struct ModelGraph {
    BlockConfig block;
    std::size_t vocabulary_size;
    std::size_t context_limit=8192;
    std::vector<float> embedding;
    std::vector<BlockWeights> layers;
    std::vector<float> output_norm;
    std::vector<float> output_head; // Empty means tied embedding/output weights.
};

inline void validate_model(const ModelGraph& model) {
    const auto width=tensor_elements(1,model.block.query_heads,model.block.head_width);
    if(model.vocabulary_size<2 || model.vocabulary_size>std::numeric_limits<std::uint32_t>::max() ||
       !model.context_limit || model.context_limit>8192 || model.layers.empty() || model.layers.size()>128)
        throw std::invalid_argument("unsupported model graph dimensions");
    const auto embedding_size=tensor_elements(model.vocabulary_size,1,width);
    if(model.embedding.size()!=embedding_size || model.output_norm.size()!=width ||
       (!model.output_head.empty() && model.output_head.size()!=embedding_size))
        throw std::invalid_argument("model embedding or output shape mismatch");
    require_finite(model.embedding); require_finite(model.output_norm); require_finite(model.output_head);
    for(const auto& layer:model.layers) validate_block(model.block,layer);
}

template<class Backend>
std::vector<float> next_token_logits(const Backend& backend, const ModelGraph& model,
                                     const std::vector<std::uint32_t>& tokens) {
    validate_model(model);
    if(tokens.empty() || tokens.size()>model.context_limit)
        throw std::invalid_argument("model context is empty or exceeds its limit");
    for(auto token:tokens)
        if(token>=model.vocabulary_size) throw std::invalid_argument("token ID outside model vocabulary");
    const auto width=tensor_elements(1,model.block.query_heads,model.block.head_width);
    std::vector<float> hidden(tensor_elements(tokens.size(),1,width));
    for(std::size_t index=0;index<tokens.size();++index) {
        const auto start=std::size_t(tokens[index])*width;
        std::copy(model.embedding.begin()+start,model.embedding.begin()+start+width,hidden.begin()+index*width);
    }
    for(const auto& layer:model.layers)
        hidden=forward_block(backend,model.block,layer,hidden,tokens.size());
    const std::vector<float> last(hidden.end()-width,hidden.end());
    const auto normalized=backend.normalize(last,model.output_norm,model.block.epsilon);
    const auto& head=model.output_head.empty() ? model.embedding : model.output_head;
    auto logits=backend.multiply(head,model.vocabulary_size,normalized);
    require_finite(logits);
    return logits;
}

inline std::uint32_t greedy_token(const std::vector<float>& logits) {
    if(logits.empty() || logits.size()>std::numeric_limits<std::uint32_t>::max())
        throw std::invalid_argument("invalid score vector");
    require_finite(logits);
    // Deterministic tie break: first vocabulary entry with the maximum score.
    return static_cast<std::uint32_t>(std::max_element(logits.begin(),logits.end())-logits.begin());
}
}
