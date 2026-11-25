#include "../src/gguf_model.hpp"
#include "../src/gpu_engine.hpp"
#include "../src/tensor_math.hpp"
#include <iostream>

int main(int argc,char** argv) {
    try {
        if(argc!=3 && argc!=4) throw std::runtime_error("usage: norama-checkpoint-probe MODEL F32_TENSOR [PROJECTION_TENSOR]");
        norama::GgufFile model(argv[1]);
        const auto weights=model.read_f32(argv[2]);
        std::vector<float> input(weights.size());
        for(std::size_t i=0;i<input.size();++i) input[i]=float(int(i%31)-15)/19;
        const auto expected=norama::rms_norm(input,weights,1e-5f);
        norama::GpuEngine gpu;
        const auto actual=gpu.normalize(input,weights,1e-5f);
        float error=0;
        for(std::size_t i=0;i<input.size();++i) error=std::max(error,std::abs(actual[i]-expected[i]));
        if(error>1e-5f) throw std::runtime_error("real checkpoint normalization disagrees with CPU");
        std::cout << "Norama.cpp actual checkpoint: " << model.tensors.size() << " tensor extents validated; "
                  << weights.size() << " real F32 weights used on " << gpu.device_name()
                  << "; max absolute error=" << error << "; not full model inference\n";
        if(argc==4) {
            const auto& tensor=model.tensor(argv[3]);
            if(tensor.dimensions.size()!=2) throw std::runtime_error("projection must be a matrix");
            const auto matrix=model.read_weights(argv[3]);
            const auto columns=static_cast<std::size_t>(tensor.dimensions[0]);
            const auto rows=static_cast<std::size_t>(tensor.dimensions[1]);
            std::vector<float> vector(columns);
            for(std::size_t i=0;i<columns;++i) vector[i]=float(int(i%37)-18)/23;
            const auto reference=norama::matvec(matrix,rows,vector);
            const auto projected=gpu.multiply(matrix,rows,vector);
            float max_error=0;
            for(std::size_t i=0;i<rows;++i) {
                const auto difference=std::abs(projected[i]-reference[i]);
                max_error=std::max(max_error,difference);
                if(difference>1e-4f+1e-4f*std::abs(reference[i]))
                    throw std::runtime_error("actual decoded projection disagrees with CPU");
            }
            std::cout<<"Own decoded GPU projection: type="<<tensor.type<<" rows="<<rows
                     <<" columns="<<columns<<" max absolute error="<<max_error
                     <<"; not a tokenizer or complete language model\n";
        }
    } catch(const std::exception& error) { std::cerr << error.what() << '\n';return 1; }
}
