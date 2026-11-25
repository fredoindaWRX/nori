#include "gpu_engine.hpp"
#include "cuda_matvec.cuh"
#include "cuda_attention.cuh"
#include "attention.hpp"
#include <cuda_fp16.h>
#include <cmath>
#include <algorithm>
#include <stdexcept>
#include <utility>

namespace norama {
namespace {
void check(cudaError_t status) {
    if(status!=cudaSuccess) throw std::runtime_error(std::string("Norama residency CUDA: ")+cudaGetErrorString(status));
}
constexpr std::size_t reserve_bytes=512ull*1024*1024;
constexpr std::size_t activation_elements=16ull*1024*1024;
struct Allocation {
    unsigned char* data=nullptr;
    int device;
    std::size_t bytes;
    Allocation(std::size_t size,int index):device(index),bytes(size) {check(cudaMalloc(&data,bytes));
#ifdef NORI_EXPERIMENTAL_NEURALESE
        experimental::allocated(bytes);
#endif
    }
    ~Allocation() {
        if(data) {int previous=0;cudaGetDevice(&previous);cudaSetDevice(device);cudaFree(data);cudaSetDevice(previous);
#ifdef NORI_EXPERIMENTAL_NEURALESE
            experimental::released(bytes);
#endif
        }
    }
    Allocation(const Allocation&)=delete;
    Allocation& operator=(const Allocation&)=delete;
};
__device__ unsigned u16(const unsigned char* p) {return unsigned(p[0])|(unsigned(p[1])<<8);}
__device__ float half_value(unsigned bits) {
    // Exact hardware conversion; upload validation still refuses Inf/NaN.
    // CPU compatibility decoding remains an independent mathematical reference.
    return __half2float(__ushort_as_half(static_cast<unsigned short>(bits)));
}
// Independent device decoder of the same validated serialized fields as weight_decode.hpp.
// Standard GGUF storage is an import boundary, not our future model architecture.
__device__ float weight_at(const unsigned char* bytes,unsigned type,std::size_t i) {
    if(type==0) {
        const auto* p=bytes+4*i;
        return __uint_as_float(unsigned(p[0])|(unsigned(p[1])<<8)|(unsigned(p[2])<<16)|(unsigned(p[3])<<24));
    }
    if(type==30) return __uint_as_float(u16(bytes+2*i)<<16);
    if(type==1) return half_value(u16(bytes+2*i));
    const auto* p=bytes+(i/256)*(type==12 ? 144 : 210);
    const unsigned local=unsigned(i%256);
    if(type==12) {
        const float d=half_value(u16(p)),minimum=half_value(u16(p+2));
        const auto* s=p+4; const unsigned group=local/32,lane=local%32;
        const unsigned scale=group<4 ? s[group]&63 : (s[group+4]&15)|((s[group-4]>>6)<<4);
        const unsigned m=group<4 ? s[group+4]&63 : (s[group+4]>>4)|((s[group]>>6)<<4);
        const unsigned quant=(p[16+(group/2)*32+lane]>>(4*(group%2)))&15;
        return (d*float(scale))*float(quant)-minimum*float(m);
    }
    const float d=half_value(u16(p+208));
    const unsigned tile=local/128,group=(local%128)/32,lane=local%32;
    const unsigned low=(p[tile*64+(group%2)*32+lane]>>(4*(group/2)))&15;
    const unsigned high=(p[128+tile*32+lane]>>(2*group))&3;
    const unsigned raw=p[192+tile*8+group*2+lane/16];
    const int scale=raw<128 ? int(raw) : int(raw)-256;
    return (d*float(scale))*float(int(low|(high<<4))-32);
}
__global__ void validate_weights(const unsigned char* data,unsigned type,std::size_t elements,int* invalid) {
    for(std::size_t i=std::size_t(blockIdx.x)*256+threadIdx.x;i<elements;i+=std::size_t(gridDim.x)*256)
        if(!isfinite(weight_at(data,type,i))) atomicExch(invalid,1);
}
__global__ void gather_rows(const unsigned char* data,unsigned type,const unsigned* tokens,float* output,
                            std::size_t columns,std::size_t elements) {
    for(std::size_t i=std::size_t(blockIdx.x)*256+threadIdx.x;i<elements;i+=std::size_t(gridDim.x)*256)
        output[i]=weight_at(data,type,std::size_t(tokens[i/columns])*columns+i%columns);
}
// One cooperative block per (output row,prompt token). Columns are coalesced;
// compressed weights stay resident and are decoded only where consumed.
__global__ void resident_projection(const unsigned char* data,unsigned type,const float* input,
                                    float* output,std::size_t rows,std::size_t columns) {
    const std::size_t row=blockIdx.x,token=blockIdx.y;
    __shared__ float sums[256];float sum=0;
    for(std::size_t column=threadIdx.x;column<columns;column+=256)
        sum+=weight_at(data,type,row*columns+column)*input[token*columns+column];
    sums[threadIdx.x]=sum;__syncthreads();
    for(int stride=128;stride;stride/=2) {
        if(threadIdx.x<stride) sums[threadIdx.x]+=sums[threadIdx.x+stride];
        __syncthreads();
    }
    if(threadIdx.x==0) output[token*rows+row]=sums[0];
}
void finite_input(const std::vector<float>& values) {
    for(float value:values) if(!std::isfinite(value)) throw std::invalid_argument("nonfinite resident input");
}
std::vector<float> read_floats(const Allocation& data,std::size_t elements) {
    std::vector<float> output(elements);
    check(cudaMemcpy(output.data(),data.data,elements*4,cudaMemcpyDeviceToHost));
    for(float x:output) if(!std::isfinite(x)) throw std::runtime_error("nonfinite resident output");
    return output;
}
}
struct ResidentMatrix::Impl {
    Allocation allocation;
    std::size_t rows,columns,bytes;
    unsigned type;
    Impl(std::size_t r,std::size_t c,std::size_t b,unsigned t,int device)
        :allocation(b,device),rows(r),columns(c),bytes(b),type(t) {}
};
struct GpuKVCache::Impl {
    Allocation key,value;
    std::size_t capacity,heads,width,count=0;
    Impl(std::size_t cap,std::size_t h,std::size_t w,int device)
        :key(cap*h*w*4,device),value(cap*h*w*4,device),capacity(cap),heads(h),width(w) {}
};
GpuKVCache::GpuKVCache(std::unique_ptr<Impl> value):impl_(std::move(value)) {}
GpuKVCache::~GpuKVCache()=default;
GpuKVCache::GpuKVCache(GpuKVCache&&) noexcept=default;
GpuKVCache& GpuKVCache::operator=(GpuKVCache&&) noexcept=default;
std::size_t GpuKVCache::token_count() const {return impl_ ? impl_->count : 0;}
void GpuKVCache::truncate(std::size_t tokens) {
    if(!impl_ || tokens>impl_->count) throw std::invalid_argument("invalid cache truncation");
    impl_->count=tokens; // Rolled-back suffix is invisible and overwritten before reuse.
}
void GpuKVCache::clear() {
    if(!impl_) throw std::invalid_argument("moved cache cannot be cleared");
    check(cudaSetDevice(impl_->key.device));
    const auto bytes=impl_->capacity*impl_->heads*impl_->width*4;
    check(cudaMemset(impl_->key.data,0,bytes));check(cudaMemset(impl_->value.data,0,bytes));
    check(cudaDeviceSynchronize());impl_->count=0;
}
ResidentMatrix::ResidentMatrix(std::unique_ptr<Impl> value):impl_(std::move(value)) {}
ResidentMatrix::~ResidentMatrix()=default;
ResidentMatrix::ResidentMatrix(ResidentMatrix&&) noexcept=default;
ResidentMatrix& ResidentMatrix::operator=(ResidentMatrix&&) noexcept=default;
std::size_t ResidentMatrix::byte_size() const {return impl_ ? impl_->bytes : 0;}
std::size_t GpuEngine::available_bytes() const {
    check(cudaSetDevice(device_index_));std::size_t free=0,total=0;check(cudaMemGetInfo(&free,&total));return free;
}
ResidentMatrix GpuEngine::upload_matrix(std::size_t rows,std::size_t columns,std::uint32_t type,
    const std::function<std::vector<unsigned char>(std::size_t,std::size_t)>& reader) const {
    if(!rows || rows>1048576 || !columns || columns>131072 || !reader)
        throw std::invalid_argument("resident matrix dimensions/reader outside limits");
    std::size_t block=1,size=0;
    switch(type) {
        case 0:size=4;break;case 1:case 30:size=2;break;
        case 12:block=256;size=144;break;case 14:block=256;size=210;break;
        default:throw std::invalid_argument("unsupported resident weight type");
    }
    if(columns%block) throw std::invalid_argument("resident row block alignment mismatch");
    const auto bytes=rows*(columns/block)*size;
    if(bytes>8ull*1024*1024*1024) throw std::invalid_argument("resident matrix exceeds 8 GiB budget");
    const auto free=available_bytes();
    if(free<reserve_bytes || bytes>free-reserve_bytes) throw std::runtime_error("insufficient GPU residency budget");
    auto result=std::make_unique<ResidentMatrix::Impl>(rows,columns,bytes,type,device_index_);
    for(std::size_t offset=0;offset<bytes;) {
        const auto count=std::min(std::size_t(64ull*1024*1024),bytes-offset);
        const auto chunk=reader(offset,count);
        if(chunk.size()!=count) throw std::runtime_error("resident upload reader returned wrong byte count");
        check(cudaMemcpy(result->allocation.data+offset,chunk.data(),count,cudaMemcpyHostToDevice));offset+=count;
    }
    Allocation flag(sizeof(int),device_index_);check(cudaMemset(flag.data,0,sizeof(int)));
    validate_weights<<<4096,256>>>(result->allocation.data,type,rows*columns,reinterpret_cast<int*>(flag.data));
    check(cudaGetLastError());int invalid=0;check(cudaMemcpy(&invalid,flag.data,sizeof(int),cudaMemcpyDeviceToHost));
    if(invalid) throw std::runtime_error("nonfinite resident model weight");
    return ResidentMatrix(std::move(result));
}
std::vector<float> GpuEngine::multiply(const ResidentMatrix& matrix,const std::vector<float>& input,
                                      std::size_t tokens) const {
    if(!matrix.impl_ || matrix.impl_->allocation.device!=device_index_)
        throw std::invalid_argument("resident matrix is moved or belongs to another device");
    const auto& m=*matrix.impl_;
    if(!tokens || tokens>128 || tokens>activation_elements/m.columns || tokens>activation_elements/m.rows ||
       input.size()!=tokens*m.columns) throw std::invalid_argument("resident projection shape/activation budget");
    finite_input(input);check(cudaSetDevice(device_index_));
    Allocation operand(input.size()*4,device_index_),output(tokens*m.rows*4,device_index_);
    check(cudaMemcpy(operand.data,input.data(),input.size()*4,cudaMemcpyHostToDevice));
    resident_projection<<<dim3(unsigned(m.rows),unsigned(tokens)),256>>>(m.allocation.data,m.type,
        reinterpret_cast<float*>(operand.data),reinterpret_cast<float*>(output.data),m.rows,m.columns);
    check(cudaGetLastError());return read_floats(output,tokens*m.rows);
}
std::vector<float> GpuEngine::normalize_batch(const std::vector<float>& input,
    const std::vector<float>& weights,float epsilon,std::size_t tokens) const {
    if(weights.empty() || weights.size()>131072 || !tokens || tokens>128 ||
       tokens>activation_elements/weights.size() || input.size()!=tokens*weights.size() ||
       !std::isfinite(epsilon) || epsilon<=0) throw std::invalid_argument("resident normalization shape/epsilon");
    finite_input(input);finite_input(weights);check(cudaSetDevice(device_index_));
    Allocation operand(input.size()*4,device_index_),parameters(weights.size()*4,device_index_),output(input.size()*4,device_index_);
    check(cudaMemcpy(operand.data,input.data(),input.size()*4,cudaMemcpyHostToDevice));
    check(cudaMemcpy(parameters.data,weights.data(),weights.size()*4,cudaMemcpyHostToDevice));
    rms_norm_f32<<<unsigned(tokens),256>>>(reinterpret_cast<float*>(operand.data),reinterpret_cast<float*>(parameters.data),
        reinterpret_cast<float*>(output.data),int(weights.size()),epsilon);
    check(cudaGetLastError());return read_floats(output,input.size());
}
std::vector<float> GpuEngine::embedding_rows(const ResidentMatrix& matrix,
                                            const std::vector<std::uint32_t>& tokens) const {
    if(!matrix.impl_ || matrix.impl_->allocation.device!=device_index_)
        throw std::invalid_argument("resident embedding is moved or belongs to another device");
    const auto& m=*matrix.impl_;
    if(tokens.empty() || tokens.size()>128 || tokens.size()>activation_elements/m.columns)
        throw std::invalid_argument("resident embedding activation budget");
    for(auto token:tokens) if(token>=m.rows) throw std::invalid_argument("resident embedding token outside vocabulary");
    check(cudaSetDevice(device_index_));
    Allocation ids(tokens.size()*sizeof(std::uint32_t),device_index_),output(tokens.size()*m.columns*4,device_index_);
    check(cudaMemcpy(ids.data,tokens.data(),tokens.size()*sizeof(std::uint32_t),cudaMemcpyHostToDevice));
    gather_rows<<<4096,256>>>(m.allocation.data,m.type,reinterpret_cast<unsigned*>(ids.data),
        reinterpret_cast<float*>(output.data),m.columns,tokens.size()*m.columns);
    check(cudaGetLastError());return read_floats(output,tokens.size()*m.columns);
}
#ifdef NORI_EXPERIMENTAL_NEURALESE
void experimental::VectorTap::capture_device(const float* values,std::size_t width,int device) {
    validate(width,1);
    if(!values || device<0) throw std::invalid_argument("invalid experimental device source");
    check(cudaSetDevice(device));
    cudaPointerAttributes attributes{};
    check(cudaPointerGetAttributes(&attributes,values));
    if(attributes.type!=cudaMemoryTypeDevice || attributes.device!=device)
        throw std::invalid_argument("experimental source must be a matching GPU allocation");
    NeuraleseVectorSnapshot result;
    result.model_id=model_id_;result.token_index=index_;result.hidden_size=width;
    result.device="cuda:"+std::to_string(device);result.vector.resize(width);
    check(cudaMemcpy(result.vector.data(),values,width*sizeof(float),cudaMemcpyDeviceToHost));
    double squared=0;
    for(float value:result.vector) {
        if(!std::isfinite(value)) throw std::runtime_error("nonfinite experimental hidden state");
        squared+=double(value)*double(value);
    }
    result.norm=std::sqrt(squared);
    snapshot_=std::move(result);captured_=true;
}
std::vector<float> GpuEngine::normalize_batch_tapped(const std::vector<float>& input,
    const std::vector<float>& weights,float epsilon,experimental::VectorTap& tap) const {
    tap.validate(weights.size(),1);
    if(input.size()!=weights.size() || !std::isfinite(epsilon) || epsilon<=0)
        throw std::invalid_argument("experimental normalization shape/epsilon");
    finite_input(input);finite_input(weights);check(cudaSetDevice(device_index_));
    Allocation operand(input.size()*4,device_index_),parameters(weights.size()*4,device_index_),output(input.size()*4,device_index_);
    check(cudaMemcpy(operand.data,input.data(),input.size()*4,cudaMemcpyHostToDevice));
    check(cudaMemcpy(parameters.data,weights.data(),weights.size()*4,cudaMemcpyHostToDevice));
    rms_norm_f32<<<1,256>>>(reinterpret_cast<float*>(operand.data),reinterpret_cast<float*>(parameters.data),
        reinterpret_cast<float*>(output.data),int(weights.size()),epsilon);
    check(cudaGetLastError());
    tap.capture_device(reinterpret_cast<float*>(output.data),input.size(),device_index_);
    return tap.snapshot().vector;
}
#endif
GpuKVCache GpuEngine::create_cache(std::size_t capacity,std::size_t kv_heads,std::size_t head_width) const {
    if(!capacity || capacity>8192 || !kv_heads || kv_heads>1024 || !head_width || head_width>65536 ||
       kv_heads>activation_elements/head_width || capacity>activation_elements/(kv_heads*head_width))
        throw std::invalid_argument("cache dimensions/allocation budget");
    const auto bytes=capacity*kv_heads*head_width*8,free=available_bytes();
    if(free<reserve_bytes || bytes>free-reserve_bytes) throw std::runtime_error("insufficient cache GPU budget");
    return GpuKVCache(std::make_unique<GpuKVCache::Impl>(capacity,kv_heads,head_width,device_index_));
}
std::vector<float> GpuEngine::attention_cached(GpuKVCache& cache,const std::vector<float>& query,
    const std::vector<float>& key,const std::vector<float>& value,std::size_t query_heads) const {
    if(!cache.impl_ || cache.impl_->key.device!=device_index_)
        throw std::invalid_argument("moved cache or cache on another device");
    auto& c=*cache.impl_;const auto kv_width=c.heads*c.width;
    if(!query_heads || query_heads>1024 || query_heads%c.heads || key.empty() || key.size()%kv_width || value.size()!=key.size())
        throw std::invalid_argument("cached attention shape mismatch");
    const auto tokens=key.size()/kv_width;
    if(tokens>128 || tokens>c.capacity-c.count || query.size()!=tensor_elements(tokens,query_heads,c.width) ||
       query.size()>activation_elements) throw std::invalid_argument("cached attention context/activation budget");
    finite_input(query);finite_input(key);finite_input(value);check(cudaSetDevice(device_index_));
    cudaDeviceProp properties{};check(cudaGetDeviceProperties(&properties,device_index_));
    const auto shared=(c.count+tokens+256)*4,blocks=tokens*query_heads;
    if(shared>properties.sharedMemPerBlock || blocks>std::size_t(properties.maxGridSize[0]))
        throw std::invalid_argument("cached attention launch limit");
    // Only the uncommitted suffix is touched; a failure leaves the old prefix readable.
    check(cudaMemcpy(c.key.data+c.count*kv_width*4,key.data(),key.size()*4,cudaMemcpyHostToDevice));
    check(cudaMemcpy(c.value.data+c.count*kv_width*4,value.data(),value.size()*4,cudaMemcpyHostToDevice));
    Allocation operand(query.size()*4,device_index_),output(query.size()*4,device_index_);
    check(cudaMemcpy(operand.data,query.data(),query.size()*4,cudaMemcpyHostToDevice));
    causal_attention_f32<<<unsigned(blocks),256,shared>>>(reinterpret_cast<float*>(operand.data),
        reinterpret_cast<float*>(c.key.data),reinterpret_cast<float*>(c.value.data),reinterpret_cast<float*>(output.data),
        int(tokens),int(query_heads),int(c.heads),int(c.width),int(c.count));
    check(cudaGetLastError());auto result=read_floats(output,query.size());
    c.count+=tokens;return result;
}
}
