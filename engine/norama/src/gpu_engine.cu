#include "gpu_engine.hpp"
#include "attention.hpp"
#include "cuda_attention.cuh"
#include "cuda_matvec.cuh"
#include <climits>
#include <limits>
#include <stdexcept>

namespace norama {
namespace {
void checked(cudaError_t error) {
    if (error != cudaSuccess) throw std::runtime_error(std::string("Norama CUDA: ") + cudaGetErrorString(error));
}
int dimension(std::size_t size) {
    if (!size || size > INT_MAX) throw std::invalid_argument("unsupported GPU dimension");
    return int(size);
}
void finite(const std::vector<float>& values) {
    for (float value : values)
        if (!std::isfinite(value)) throw std::invalid_argument("nonfinite GPU input");
}
cudaDeviceProp select_device(int index) {
    checked(cudaSetDevice(index));
    cudaDeviceProp properties{};
    checked(cudaGetDeviceProperties(&properties,index));
    return properties;
}
struct Buffer {
    float* data = nullptr;
    std::size_t count;
    explicit Buffer(std::size_t elements) : count(elements) {
        if (!elements || elements > std::numeric_limits<std::size_t>::max() / sizeof(float))
            throw std::invalid_argument("invalid GPU allocation size");
        checked(cudaMalloc(&data, elements * sizeof(float)));
#ifdef NORI_EXPERIMENTAL_NEURALESE
        experimental::allocated(count*sizeof(float));
#endif
    }
    explicit Buffer(const std::vector<float>& values) : Buffer(values.size()) {
        // A throwing constructor must release its allocation itself.
        const auto status=cudaMemcpy(data,values.data(),count*sizeof(float),cudaMemcpyHostToDevice);
        if (status!=cudaSuccess) { cudaFree(data); data=nullptr;
#ifdef NORI_EXPERIMENTAL_NEURALESE
            experimental::released(count*sizeof(float));
#endif
            checked(status); }
    }
    ~Buffer() { if (data) {cudaFree(data);
#ifdef NORI_EXPERIMENTAL_NEURALESE
        experimental::released(count*sizeof(float));
#endif
    } }
    Buffer(const Buffer&) = delete;
    Buffer& operator=(const Buffer&) = delete;
    std::vector<float> read() const {
        std::vector<float> values(count);
        checked(cudaMemcpy(values.data(),data,count*sizeof(float),cudaMemcpyDeviceToHost));
        for (float x: values)
            if (!std::isfinite(x)) throw std::runtime_error("nonfinite GPU output");
        return values;
    }
};
void completed() {
    checked(cudaGetLastError());
    checked(cudaDeviceSynchronize());
}
}

GpuEngine::GpuEngine(int device_index) : device_index_(device_index) {
    if (device_index < 0) throw std::invalid_argument("negative device index");
    select_device(device_index_);
}
std::string GpuEngine::device_name() const { return select_device(device_index_).name; }

std::vector<float> GpuEngine::attention(const std::vector<float>& query, const std::vector<float>& key,
                                       const std::vector<float>& value, std::size_t tokens,
                                       std::size_t query_heads, std::size_t kv_heads, std::size_t width) const {
    const auto q_count=tensor_elements(tokens,query_heads,width);
    const auto kv_count=tensor_elements(tokens,kv_heads,width);
    if (query_heads % kv_heads || query.size()!=q_count || key.size()!=kv_count || value.size()!=kv_count)
        throw std::invalid_argument("GPU attention shape mismatch");
    dimension(tokens); dimension(query_heads); dimension(kv_heads); dimension(width);
    // Bounded prototype; larger contexts require tiled attention, not unbounded shared memory.
    if (tokens>8192) throw std::invalid_argument("prototype attention context exceeds 8192 tokens");
    if (width>65536 || query_heads>1024)
        throw std::invalid_argument("prototype attention head dimensions exceed limits");
    const auto properties=select_device(device_index_);
    const auto blocks=tokens*query_heads;
    const auto shared_bytes=(tokens+256)*sizeof(float);
    if (blocks>std::size_t(properties.maxGridSize[0]) || shared_bytes>properties.sharedMemPerBlock)
        throw std::invalid_argument("attention launch exceeds device limits");
    finite(query); finite(key); finite(value);
    Buffer dq(query), dk(key), dv(value), output(q_count);
    causal_attention_f32<<<unsigned(blocks),256,shared_bytes>>>(
        dq.data,dk.data,dv.data,output.data,int(tokens),int(query_heads),int(kv_heads),int(width));
    completed();
    return output.read();
}

std::vector<float> GpuEngine::normalize(const std::vector<float>& input,
                                       const std::vector<float>& weights, float epsilon) const {
    dimension(input.size());
    if (input.size()!=weights.size() || !std::isfinite(epsilon) || epsilon<=0)
        throw std::invalid_argument("GPU normalization shape or epsilon");
    finite(input); finite(weights); select_device(device_index_);
    Buffer data(input), parameters(weights), output(input.size());
    rms_norm_f32<<<1,256>>>(data.data,parameters.data,output.data,int(input.size()),epsilon);
    completed();
    return output.read();
}

std::vector<float> GpuEngine::multiply(const std::vector<float>& matrix, std::size_t rows,
                                      const std::vector<float>& vector) const {
    dimension(rows); dimension(vector.size());
    if (matrix.size()/rows!=vector.size() || matrix.size()%rows)
        throw std::invalid_argument("GPU multiplication shape mismatch");
    finite(matrix); finite(vector);
    const auto properties=select_device(device_index_);
    const auto blocks=(rows+31)/32;
    if (blocks>std::size_t(properties.maxGridSize[0])) throw std::invalid_argument("multiplication grid limit");
    Buffer data(matrix), operand(vector), output(rows);
    matvec_f32<<<unsigned(blocks),32>>>(data.data,operand.data,output.data,int(rows),int(vector.size()));
    completed();
    return output.read();
}
}
