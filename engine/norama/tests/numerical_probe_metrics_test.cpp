#include "numerical_probe_metrics.hpp"
#include <iostream>
void require(bool condition){if(!condition)throw std::runtime_error("comparison metric assertion failed");}
template<class F>void rejects(F action){bool caught=false;try{action();}catch(const std::exception&){caught=true;}require(caught);}
int main(){
    try {
        const auto exact=norama_test::compare_logits({1,2,3},{1,2,3});
        require(exact.count==3 && exact.reference_top==2 && exact.actual_top==2);
        require(exact.max_absolute==0 && exact.rms==0 && std::abs(exact.cosine-1)<1e-12);
        require(exact.reference_margin==1);norama_test::require_agreement(exact,1e-3);
        const auto shifted=norama_test::compare_logits({1,2,3},{1.0001f,2,3});
        require(shifted.max_absolute>0 && shifted.rms>0);norama_test::require_agreement(shifted,1e-3);
        rejects([&]{norama_test::require_agreement(shifted,1e-6);});
        const auto tied=norama_test::compare_logits({1,1},{1,1.00001f});
        require(tied.reference_margin==0);rejects([&]{norama_test::require_agreement(tied,1e-3);});
        rejects([]{norama_test::compare_logits({},{});});
        rejects([]{norama_test::compare_logits({1},{1});});
        rejects([]{norama_test::compare_logits({1,2},{1});});
        rejects([]{norama_test::compare_logits({1,2},{1,std::numeric_limits<float>::infinity()});});
        rejects([]{norama_test::compare_logits({1,std::numeric_limits<float>::quiet_NaN()},{1,2});});
        rejects([&]{norama_test::require_agreement(exact,0);});
        rejects([&]{norama_test::require_agreement(exact,std::numeric_limits<double>::quiet_NaN());});
        std::cout<<"All-logit metrics/finite/shape/tie/tolerance fixtures pass\n";return 0;
    }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}
