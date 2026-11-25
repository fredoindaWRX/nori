#include "gguf_model.hpp"
#include <iostream>

int main(int argc,char** argv) {
    try {
        if(argc!=2 && argc!=3 && argc!=4) throw std::runtime_error("usage: norama-header MODEL [--inspect | --describe | --read-f32 TENSOR | --read-weights TENSOR]");
        if((argc==3 && std::string(argv[2])!="--inspect" && std::string(argv[2])!="--describe") ||
           (argc==4 && std::string(argv[2])!="--read-f32" && std::string(argv[2])!="--read-weights")) throw std::runtime_error("unknown option");
        norama::GgufFile model(argv[1],argc>2);
        std::cout << "Norama.cpp GGUF header: version=3 tensors=" << model.tensor_count
                  << " metadata=" << model.metadata_count << '\n';
        if(argc>2) {
            const auto architecture=model.metadata.find("general.architecture");
            if(architecture!=model.metadata.end()) std::cout << "architecture=" << architecture->second.text << '\n';
            for(std::size_t i=0;i<std::min(std::size_t(3),model.tensors.size());++i) {
                const auto& tensor=model.tensors[i];
                std::cout << "tensor=" << tensor.name << " type=" << tensor.type << " offset=" << tensor.offset
                          << " bytes=" << tensor.bytes << '\n';
            }
            std::cout << "tensor byte extents validated; data_start=" << model.data_start << '\n';
        }
        if(argc==3 && std::string(argv[2])=="--describe") {
            for(const auto& entry:model.metadata) {
                const auto& value=entry.second;
                if(value.type==9) {
                    std::cout<<entry.first<<" array_count="<<value.items.size()<<'\n';continue;
                }
                std::cout<<entry.first<<" type="<<value.type<<" value=";
                if(value.type==8) std::cout<<value.text;
                else if(value.type==6) {
                    const auto bits=static_cast<std::uint32_t>(value.bits);
                    float number; std::memcpy(&number,&bits,4);std::cout<<number;
                } else std::cout<<value.bits;
                std::cout<<'\n';
            }
            for(const auto& tensor:model.tensors) {
                std::cout<<tensor.name<<" type="<<tensor.type<<" dimensions=";
                for(auto size:tensor.dimensions) std::cout<<size<<',';
                std::cout<<'\n';
            }
        }
        if(argc==4) {
            const bool f32=std::string(argv[2])=="--read-f32";
            const auto weights=f32 ? model.read_f32(argv[3]) : model.read_weights(argv[3]);
            const auto range=std::minmax_element(weights.begin(),weights.end());
            std::cout << "loaded " << (f32 ? "F32" : "decoded") << " tensor=" << argv[3] << " elements=" << weights.size()
                      << " minimum=" << *range.first << " maximum=" << *range.second << '\n';
        }
    } catch(const std::exception& error) { std::cerr << error.what() << '\n';return 1; }
}
