// Read-only actual metadata acceptance / decoded-resource refusal.
#include "../src/checkpoint_graph.hpp"
#include <iostream>
int main(int argc,char** argv) {
    try {
        if(argc!=2) throw std::runtime_error("requires actual large-layer checkpoint");
        norama::GgufFile file(argv[1]);
        norama::CheckpointGraph plan(file);
        if(plan.decoded_layer_bytes()<=512ull*1024*1024)
            throw std::runtime_error("test requires a layer above the decoded budget");
        norama::CpuReference reference;
        bool refused=false;
        try {plan.logits(reference,{1});}
        catch(const std::runtime_error& e) {
            refused=std::string(e.what())=="decoded layer exceeds 512 MiB limit";
        }
        if(!refused) throw std::runtime_error("decoded resource defense was bypassed");
        std::cout<<"Actual metadata plan PASS; decoded path refuses oversized layer before execution; "
                 <<"decoded_layer_bytes="<<plan.decoded_layer_bytes()<<" layers="<<plan.layer_count()<<'\n';
        return 0;
    }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}
}
