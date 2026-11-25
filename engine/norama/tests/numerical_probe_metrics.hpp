#pragma once
#include "../src/model_graph.hpp"
#include <cmath>
#include <limits>

namespace norama_test {
struct LogitComparison {
    std::size_t count, reference_top, actual_top;
    double max_absolute, rms, cosine, reference_margin;
};
// Different accumulation orders can differ slightly, but all logits count.
// Never compare only the winning token or ignore a nonfinite/outlier entry.
inline LogitComparison compare_logits(const std::vector<float>& reference,
                                     const std::vector<float>& actual) {
    if(reference.size()<2 || reference.size()>1048576 || actual.size()!=reference.size())
        throw std::invalid_argument("numerical comparison shape outside bounds");
    double worst=0,squared=0,dot=0,aa=0,bb=0;
    for(std::size_t i=0;i<reference.size();++i) {
        if(!std::isfinite(reference[i]) || !std::isfinite(actual[i]))
            throw std::invalid_argument("nonfinite comparison logit");
        const double a=reference[i],b=actual[i],difference=a-b;
        worst=std::max(worst,std::abs(difference));squared+=difference*difference;
        dot+=a*b;aa+=a*a;bb+=b*b;
    }
    const auto top=norama::greedy_token(reference);
    double runner=-std::numeric_limits<double>::infinity();
    for(std::size_t i=0;i<reference.size();++i) if(i!=top) runner=std::max(runner,double(reference[i]));
    return {reference.size(),top,norama::greedy_token(actual),worst,
            std::sqrt(squared/reference.size()),aa>0 && bb>0 ? dot/std::sqrt(aa*bb) : 0,
            double(reference[top])-runner};
}
inline void require_agreement(const LogitComparison& result,double tolerance) {
    if(!std::isfinite(tolerance) || tolerance<=0)
        throw std::invalid_argument("invalid numerical comparison tolerance");
    if(result.max_absolute>=tolerance || result.reference_top!=result.actual_top)
        throw std::runtime_error("numerical logit agreement failed");
}
}
