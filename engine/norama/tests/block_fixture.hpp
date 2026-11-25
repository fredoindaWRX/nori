#pragma once
#include "../src/transformer_block.hpp"

inline norama::BlockWeights block_fixture(const norama::BlockConfig& config, bool patterned=false) {
    const auto width=config.query_heads*config.head_width, kv=config.kv_heads*config.head_width;
    norama::BlockWeights weights;
    weights.attention_norm.assign(width,1);
    weights.feed_forward_norm.assign(width,1);
    weights.query.resize(width*width); weights.key.resize(kv*width); weights.value.resize(kv*width);
    weights.attention_output.resize(width*width);
    weights.gate.resize(config.feed_forward_width*width); weights.up.resize(weights.gate.size());
    weights.down.resize(width*config.feed_forward_width);
    if(patterned) {
        int seed=0;
        for(auto* tensor : {&weights.query,&weights.key,&weights.value,&weights.attention_output,
                            &weights.gate,&weights.up,&weights.down}) {
            for(std::size_t i=0;i<tensor->size();++i) (*tensor)[i]=float(int((i+seed)%19)-9)/53;
            seed+=3;
        }
    }
    return weights;
}
