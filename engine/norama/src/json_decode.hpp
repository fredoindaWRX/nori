#pragma once
#include "json_prefix.hpp"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <functional>
#include <numeric>
#include <stdexcept>

namespace norama {
// Highest-scoring token whose ENTIRE bytes preserve the JSON prefix. This is
// syntax-only constrained greedy decoding; it never invents a correct plan.
template<class Prefix,class Decode,class Stop>
std::uint32_t json_greedy_token(const std::vector<float>& scores,Prefix& prefix,
                               const Decode& decode,const Stop& stop,
                               const std::function<bool()>& cancelled={}) {
    if(scores.empty() || scores.size()>1048576 || !prefix.valid() || prefix.complete())
        throw std::invalid_argument("invalid JSON decoder state or vocabulary");
    const auto check=[&] {if(cancelled && cancelled()) throw std::runtime_error("JSON decoding cancelled");};
    check();
    std::vector<std::uint32_t> ranked(scores.size());std::iota(ranked.begin(),ranked.end(),0);
    for(std::size_t i=0;i<scores.size();++i) {
        if(i%256==0) check();
        if(!std::isfinite(scores[i])) throw std::invalid_argument("nonfinite JSON decoder score");
    }
    std::sort(ranked.begin(),ranked.end(),[&](auto a,auto b) {
        return scores[a]!=scores[b] ? scores[a]>scores[b] : a<b;
    });
    check();
    for(std::size_t i=0;i<ranked.size();++i) {
        if(i%256==0) check();
        const auto id=ranked[i];
        if(stop(id)) continue; // EOS cannot finish a still-incomplete object.
        const auto bytes=decode(id);
        if(bytes.empty()) continue; // Control/empty tokens must not bypass the guard.
        auto trial=prefix;
        if(!trial.append(bytes)) continue;
        check();prefix=std::move(trial);return id;
    }
    throw std::runtime_error("no token preserves JSON-object prefix");
}
}
