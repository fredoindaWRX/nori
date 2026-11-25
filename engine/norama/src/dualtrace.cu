#include "dualtrace_gpu.cuh"
#include <iomanip>
#include <iostream>
#include <memory>

unsigned bounded_integer(const std::string& text,unsigned maximum){
    if(text.empty()||text.size()>6||text.find_first_not_of("0123456789")!=std::string::npos)throw std::runtime_error("invalid numeric argument");
    const auto number=std::stoul(text);if(number>maximum)throw std::runtime_error("argument bound");return unsigned(number);
}
std::string json_string(const std::string& text) {
    std::string result="\"";
    for(unsigned char value:text) {
        if(value=='\"'||value=='\\'){result+='\\';result+=char(value);}
        else if(value<32 || value>126)throw std::runtime_error("non-ASCII device name");
        else result+=char(value);
    }
    return result+'\"';
}
int main(int argc,char** argv) {
    try {
        if(argc<4||argc>517)throw std::runtime_error("usage: model.ndt cpu|gpu [--generate=1..256] token_ids");
        const std::string device=argv[2];if(device!="cpu"&&device!="gpu")throw std::runtime_error("unknown device");
        unsigned generation=0;int start=3;
        if(std::string(argv[3]).find("--generate=")==0){generation=bounded_integer(std::string(argv[3]).substr(11),256);if(!generation)throw std::runtime_error("empty generation");start=4;}
        std::vector<unsigned> tokens;for(int i=start;i<argc;++i)tokens.push_back(bounded_integer(argv[i],257));
        if(tokens.empty()||tokens.size()+generation>512)throw std::runtime_error("token budget");
        norama::dualtrace::Model model(argv[1]);norama::dualtrace::Cpu cpu(model);
        std::unique_ptr<norama::dualtrace::Gpu> gpu;if(device=="gpu")gpu=std::make_unique<norama::dualtrace::Gpu>(model);
        auto step=[&](unsigned token){return gpu?gpu->step(token):cpu.step(token);};
        std::vector<std::vector<float>> scores;for(auto token:tokens)scores.push_back(step(token));
        std::vector<unsigned> generated;auto last=scores.back();
        for(unsigned i=0;i<generation;++i){auto token=unsigned(std::max_element(last.begin(),last.end())-last.begin());if(token==257)break;generated.push_back(token);last=step(token);}
        // Reset/replay proof is mandatory for this prototype diagnostic.
        if(gpu)gpu->reset();else cpu.reset();
        float reset_error=0;for(unsigned i=0;i<tokens.size();++i){const auto replay=step(tokens[i]);for(unsigned j=0;j<258;++j)reset_error=std::max(reset_error,std::fabs(replay[j]-scores[i][j]));}
        std::cout<<std::setprecision(9)<<"{\"architecture\":\"nori-dualtrace-v0\",\"assistant_qualified\":false,\"device\":\""<<device
                 <<"\",\"device_name\":"<<json_string(gpu?gpu->device_name:"CPU")
                 <<",\"parameters\":"<<model.weights.size()<<",\"reset_max_error\":"<<reset_error<<",\"logits\":[";
        for(unsigned i=0;i<scores.size();++i){if(i)std::cout<<',';std::cout<<'[';for(unsigned j=0;j<258;++j){if(j)std::cout<<',';std::cout<<scores[i][j];}std::cout<<']';}
        std::cout<<"],\"generated\":[";for(unsigned i=0;i<generated.size();++i){if(i)std::cout<<',';std::cout<<generated[i];}std::cout<<"]}"<<std::endl;
        return reset_error==0?0:2;
    }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}
