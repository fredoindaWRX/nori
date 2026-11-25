#pragma once
// Own fixed graph/data format. No GGUF, Llama or training-library inference.
#define NOMINMAX
#include <windows.h>
#include <bcrypt.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <filesystem>
#include <stdexcept>
#include <string>
#include <vector>

namespace norama::dualtrace {
constexpr unsigned vocabulary=258,maximum_tokens=512;
constexpr unsigned maximum_width=512,maximum_layers=8;
constexpr std::size_t maximum_model_bytes=64ull*1024*1024;
inline std::array<unsigned char,32> digest(const unsigned char* data,std::size_t size) {
    BCRYPT_ALG_HANDLE algorithm=nullptr; BCRYPT_HASH_HANDLE hash=nullptr;
    std::vector<unsigned char> object; std::array<unsigned char,32> result{};
    auto check=[](NTSTATUS status){if(status<0) throw std::runtime_error("Windows SHA256 failed");};
    try {
        check(BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,nullptr,0));
        ULONG length=0,got=0;
        check(BCryptGetProperty(algorithm,BCRYPT_OBJECT_LENGTH,reinterpret_cast<PUCHAR>(&length),sizeof(length),&got,0));
        if(length>65536 || size>maximum_model_bytes) throw std::runtime_error("digest input bounds");
        object.resize(length);
        check(BCryptCreateHash(algorithm,&hash,object.data(),length,nullptr,0,0));
        check(BCryptHashData(hash,const_cast<PUCHAR>(data),ULONG(size),0));
        check(BCryptFinishHash(hash,result.data(),ULONG(result.size()),0));
        BCryptDestroyHash(hash);BCryptCloseAlgorithmProvider(algorithm,0);return result;
    } catch(...) {if(hash) BCryptDestroyHash(hash);if(algorithm) BCryptCloseAlgorithmProvider(algorithm,0);throw;}
}
inline std::uint32_t integer(const std::vector<unsigned char>& bytes,std::size_t at) {
    if(at>bytes.size() || bytes.size()-at<4) throw std::runtime_error("truncated model header");
    return std::uint32_t(bytes[at]) | (std::uint32_t(bytes[at+1])<<8) |
           (std::uint32_t(bytes[at+2])<<16) | (std::uint32_t(bytes[at+3])<<24);
}
struct Layer {
    std::size_t proposal,proposal_bias,gate,gate_bias,decay,mix,mix_bias,norm,norm_bias;
};
struct Model {
    unsigned width=0;std::vector<Layer> layers;std::vector<float> weights;
    std::size_t embedding=0,output=0,output_bias=0;
    std::array<unsigned char,32> source_digest{};
    explicit Model(const std::filesystem::path& path) {
        std::ifstream input(path,std::ios::binary|std::ios::ate);
        if(!input) throw std::runtime_error("model file unavailable");
        const auto size=input.tellg();
        if(size<96 || size>maximum_model_bytes) throw std::runtime_error("model file size bound");
        std::vector<unsigned char> raw(static_cast<std::size_t>(size));input.seekg(0);
        if(!input.read(reinterpret_cast<char*>(raw.data()),size)) throw std::runtime_error("model read incomplete");
        const std::array<unsigned char,8> magic{'N','D','T','0','F','3','2',0};
        if(!std::equal(magic.begin(),magic.end(),raw.begin()) || integer(raw,8)!=1)
            throw std::runtime_error("unsupported native Nori model format");
        width=integer(raw,12);const auto count=integer(raw,16),floats=integer(raw,20);
        if(width<8 || width>maximum_width || count<1 || count>maximum_layers || integer(raw,24)!=1 || integer(raw,28)!=0)
            throw std::runtime_error("invalid graph bounds,origin or qualification");
        const std::size_t expected=2*vocabulary*width+vocabulary+count*(4*width*width+6*width);
        if(floats!=expected || raw.size()!=96+4*expected) throw std::runtime_error("tensor payload shape/size mismatch");
        const auto actual=digest(raw.data()+96,raw.size()-96);
        if(!std::equal(actual.begin(),actual.end(),raw.begin()+64)) throw std::runtime_error("model payload SHA256 mismatch");
        std::copy(raw.begin()+32,raw.begin()+64,source_digest.begin());
        weights.resize(expected);std::memcpy(weights.data(),raw.data()+96,expected*4);
        for(float value:weights) if(!std::isfinite(value)) throw std::runtime_error("nonfinite model tensor");
        std::size_t cursor=vocabulary*width;
        auto take=[&](std::size_t n){const auto old=cursor;cursor+=n;return old;};
        for(unsigned i=0;i<count;++i) layers.push_back({take(width*width),take(width),take(width*width),
            take(width),take(width),take(2*width*width),take(width),take(width),take(width)});
        output=take(vocabulary*width);output_bias=take(vocabulary);
        if(cursor!=expected) throw std::runtime_error("native graph layout mismatch");
    }
};
inline float sigmoid(float x){return 1.f/(1.f+std::exp(-x));}
class Cpu {
    const Model& model_;std::vector<float> state_;unsigned consumed_=0;
    float linear(std::size_t matrix,std::size_t bias,unsigned row,const std::vector<float>& input) const {
        double result=model_.weights[bias+row];
        for(unsigned col=0;col<input.size();++col) result+=double(model_.weights[matrix+row*input.size()+col])*input[col];
        return float(result);
    }
public:
    explicit Cpu(const Model& model):model_(model),state_(2*model.layers.size()*model.width,0.f){}
    void reset(){std::fill(state_.begin(),state_.end(),0.f);consumed_=0;}
    std::vector<float> step(unsigned token) {
        if(token>=vocabulary || consumed_>=maximum_tokens) throw std::runtime_error("token or recurrent session bound");
        ++consumed_;const auto w=model_.width;
        std::vector<float> value(model_.weights.begin()+token*w,model_.weights.begin()+(token+1)*w);
        for(unsigned i=0;i<model_.layers.size();++i) {
            const auto& layer=model_.layers[i];std::vector<float> joined(2*w),next(w);
            for(unsigned col=0;col<w;++col) {
                const float proposal=std::tanh(linear(layer.proposal,layer.proposal_bias,col,value));
                const float gate=sigmoid(linear(layer.gate,layer.gate_bias,col,value));
                const float decay=0.8f+0.199f*sigmoid(model_.weights[layer.decay+col]);
                const auto fast=2*i*w+col,slow=fast+w;
                state_[fast]=(1-gate)*state_[fast]+gate*proposal;
                state_[slow]=decay*state_[slow]+(1-decay)*proposal;
                joined[col]=state_[fast];joined[col+w]=state_[slow];
            }
            double mean=0,variance=0;
            for(unsigned col=0;col<w;++col){next[col]=value[col]+std::tanh(linear(layer.mix,layer.mix_bias,col,joined));mean+=next[col];}
            mean/=w;
            for(float x:next) variance+=(x-mean)*(x-mean);
            const double scale=1/std::sqrt(variance/w+1e-5);
            for(unsigned col=0;col<w;++col) value[col]=float((next[col]-mean)*scale*model_.weights[layer.norm+col]+model_.weights[layer.norm_bias+col]);
        }
        std::vector<float> scores(vocabulary);
        for(unsigned row=0;row<vocabulary;++row) {
            scores[row]=linear(model_.output,model_.output_bias,row,value);
            if(!std::isfinite(scores[row])) throw std::runtime_error("nonfinite native scores");
        }
        return scores;
    }
};
}
