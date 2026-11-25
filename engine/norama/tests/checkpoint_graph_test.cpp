#include "../src/checkpoint_graph.hpp"
#include <iostream>

template<class Operation> void rejects(Operation operation) {
    bool rejected=false;try {operation();}catch(const std::exception&){rejected=true;}
    if(!rejected) throw std::runtime_error("invalid checkpoint operation accepted");
}
int main(int argc,char** argv) {
    try {
        // Independent analytic scaled/interleaved RoPE fixture.
        std::vector<float> rotary={1,2,3,4,5,6};
        norama::rotate_positions(rotary,1,1,6,4,100,1,true,{2,4});
        const auto near=[](float x,double y){if(std::abs(x-y)>1e-6) throw std::runtime_error("scaled rotary mismatch");};
        near(rotary[0],std::cos(.5)-2*std::sin(.5));
        near(rotary[1],std::sin(.5)+2*std::cos(.5));
        near(rotary[2],3*std::cos(.025)-4*std::sin(.025));
        near(rotary[3],3*std::sin(.025)+4*std::cos(.025));
        if(rotary[4]!=5 || rotary[5]!=6) throw std::runtime_error("rotary tail changed");
        rejects([&]{norama::rotate_positions(rotary,1,1,6,4,100,1,true,{0,1});});
        rejects([&]{norama::rotate_positions(rotary,1,1,6,4,100,1,true,{1});});
        if(argc!=2 && argc!=3) throw std::runtime_error("requires synthetic checkpoint fixture");
        norama::GgufFile file(argv[1]);norama::CheckpointGraph graph(file);
        if(graph.layer_count()!=2 || graph.vocabulary_size()!=5) throw std::runtime_error("fixture dimensions mismatch");
        norama::CpuReference cpu;
        const auto actual=graph.logits(cpu,{1,2});
        const auto embeddings=file.read_weights("token_embd.weight");
        auto expected=norama::matvec(embeddings,5,norama::rms_norm({3,0,0,0},{1,1,1,1},1e-5f));
        if(argc==3) {
            norama::ModelGraph reference{norama::BlockConfig{2,1,2,8},5};
            reference.block.rotary_interleaved=true;reference.block.rotary_factors={1};
            reference.embedding=embeddings;reference.output_norm={1,1,1,1};
            const auto matrix=[](std::size_t count,int salt) {
                std::vector<float> result(count);
                for(std::size_t i=0;i<count;++i) result[i]=float(int((i+salt)%11)-5)/97;
                return result;
            };
            for(int layer=0;layer<2;++layer) {
                const auto salt=layer*7;
                reference.layers.push_back({{1,1,1,1},matrix(16,salt+1),matrix(8,salt+2),
                    matrix(8,salt+3),matrix(16,salt+4),{1,1,1,1},matrix(32,salt+5),
                    matrix(32,salt+6),matrix(32,salt+7)});
            }
            expected=norama::next_token_logits(cpu,reference,{1,2});
        }
        for(std::size_t i=0;i<actual.size();++i) near(actual[i],expected[i]);
        if(norama::greedy_token(actual)!=4) throw std::runtime_error("imported analytic greedy mismatch");
        rejects([&]{graph.logits(cpu,{});});rejects([&]{graph.logits(cpu,{5});});
        rejects([&]{graph.logits(cpu,std::vector<std::uint32_t>(17,1));});
        rejects([&]{graph.logits(cpu,{1},[]{return true;});});
        bool cancel=false;std::size_t completed=0;
        rejects([&]{graph.logits(cpu,{1},[&]{return cancel;},[&](auto count){completed=count;cancel=true;});});
        if(completed!=1 || graph.logits(cpu,{1}).size()!=5) throw std::runtime_error("cancel/reuse mismatch");
        std::cout<<"Imported complete synthetic graph: analytic logits,rotary,context,cancellation and reuse pass\n";
    }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}
