#pragma once
#include "dualtrace_model.hpp"
#include <cuda_runtime.h>

namespace norama::dualtrace {
__device__ float gate_value(float x){return 1.f/(1.f+expf(-x));}
// One bounded block executes the small recurrent graph. All weights/state
// stay resident; output logits are the only per-token device-host transfer.
__global__ void step_kernel(const float* weights,const Layer* layers,unsigned count,unsigned width,
                            std::size_t output,std::size_t bias,unsigned token,float* state,float* scores) {
    __shared__ float value[maximum_width],next[maximum_width],joined[2*maximum_width],mean,scale;
    const unsigned col=threadIdx.x;
    if(col<width)value[col]=weights[token*width+col];__syncthreads();
    for(unsigned layer_index=0;layer_index<count;++layer_index) {
        const auto layer=layers[layer_index];
        if(col<width) {
            float p=weights[layer.proposal_bias+col],g=weights[layer.gate_bias+col];
            for(unsigned j=0;j<width;++j){p+=weights[layer.proposal+col*width+j]*value[j];g+=weights[layer.gate+col*width+j]*value[j];}
            p=tanhf(p);g=gate_value(g);const float decay=.8f+.199f*gate_value(weights[layer.decay+col]);
            const auto fast=2*layer_index*width+col,slow=fast+width;
            joined[col]=state[fast]=(1-g)*state[fast]+g*p;
            joined[col+width]=state[slow]=decay*state[slow]+(1-decay)*p;
        }
        __syncthreads();
        if(col<width) {
            float sum=weights[layer.mix_bias+col];
            for(unsigned j=0;j<2*width;++j)sum+=weights[layer.mix+col*2*width+j]*joined[j];
            next[col]=value[col]+tanhf(sum);
        }
        __syncthreads();
        if(col==0) {
            float sum=0;for(unsigned j=0;j<width;++j)sum+=next[j];mean=sum/width;
            sum=0;for(unsigned j=0;j<width;++j){const float x=next[j]-mean;sum+=x*x;}
            scale=rsqrtf(sum/width+1e-5f);
        }
        __syncthreads();
        if(col<width)value[col]=(next[col]-mean)*scale*weights[layer.norm+col]+weights[layer.norm_bias+col];
        __syncthreads();
    }
    if(col<vocabulary) {
        float sum=weights[bias+col];for(unsigned j=0;j<width;++j)sum+=weights[output+col*width+j]*value[j];
        scores[col]=sum;
    }
}
class Gpu {
    const Model& model_;float *weights_=nullptr,*state_=nullptr,*scores_=nullptr;
    Layer* layers_=nullptr;unsigned consumed_=0;
    static void check(cudaError_t error){if(error!=cudaSuccess)throw std::runtime_error(std::string("Nori CUDA: ")+cudaGetErrorString(error));}
    void release(){cudaFree(weights_);cudaFree(state_);cudaFree(scores_);cudaFree(layers_);}
public:
    std::string device_name;
    explicit Gpu(const Model& model):model_(model) {
        try {
            check(cudaSetDevice(0));cudaDeviceProp props{};check(cudaGetDeviceProperties(&props,0));
            if(props.maxThreadsPerBlock<512)throw std::runtime_error("device block limit");device_name=props.name;
            check(cudaMalloc(&weights_,model.weights.size()*4));
            check(cudaMalloc(&state_,2*model.layers.size()*model.width*4));
            check(cudaMalloc(&scores_,vocabulary*4));check(cudaMalloc(&layers_,model.layers.size()*sizeof(Layer)));
            check(cudaMemcpy(weights_,model.weights.data(),model.weights.size()*4,cudaMemcpyHostToDevice));
            check(cudaMemcpy(layers_,model.layers.data(),model.layers.size()*sizeof(Layer),cudaMemcpyHostToDevice));
            reset();
        }catch(...){release();throw;}
    }
    ~Gpu(){release();}
    Gpu(const Gpu&)=delete;Gpu& operator=(const Gpu&)=delete;
    std::size_t resident_bytes() const {
        return model_.weights.size()*sizeof(float)+2*model_.layers.size()*model_.width*sizeof(float)
               +vocabulary*sizeof(float)+model_.layers.size()*sizeof(Layer);
    }
    void reset(){check(cudaMemset(state_,0,2*model_.layers.size()*model_.width*4));consumed_=0;}
    std::vector<float> step(unsigned token) {
        if(token>=vocabulary || consumed_>=maximum_tokens)throw std::runtime_error("token or recurrent session bound");
        ++consumed_;step_kernel<<<1,512>>>(weights_,layers_,unsigned(model_.layers.size()),model_.width,
            model_.output,model_.output_bias,token,state_,scores_);
        check(cudaGetLastError());std::vector<float> result(vocabulary);
        check(cudaMemcpy(result.data(),scores_,vocabulary*4,cudaMemcpyDeviceToHost));
        for(float value:result)if(!std::isfinite(value))throw std::runtime_error("nonfinite CUDA scores");
        return result;
    }
};
}
