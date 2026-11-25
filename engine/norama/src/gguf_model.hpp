#pragma once
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <cmath>
#include <fstream>
#include <limits>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>
#include "weight_decode.hpp"

namespace norama {
struct GgufValue {
    std::uint32_t type=0;
    std::uint64_t bits=0;
    std::string text;
    std::vector<GgufValue> items;
};
struct GgufTensor {
    std::string name;
    std::vector<std::uint64_t> dimensions;
    std::uint32_t type;
    std::uint64_t offset, elements, bytes;
};

// Independently implemented bounded little-endian GGUF-v3 reader.
// Supported storage layouts: F32/F16/BF16/Q4_K/Q6_K; no ggml/llama linkage.
class GgufFile {
private:
    std::uint64_t tensor_count_=0, metadata_count_=0, data_start_=0;
    std::map<std::string,GgufValue> metadata_;
    std::vector<GgufTensor> tensors_;
public:
    const std::uint64_t& tensor_count=tensor_count_;
    const std::uint64_t& metadata_count=metadata_count_;
    const std::uint64_t& data_start=data_start_;
    const std::map<std::string,GgufValue>& metadata=metadata_;
    const std::vector<GgufTensor>& tensors=tensors_;
    GgufFile(const GgufFile&)=delete;
    GgufFile& operator=(const GgufFile&)=delete;
    GgufFile(GgufFile&&)=delete;
    GgufFile& operator=(GgufFile&&)=delete;
    explicit GgufFile(const std::string& path, bool inspect=true) : input_(path,std::ios::binary) {
        if(!input_) throw std::runtime_error("cannot open model");
        input_.seekg(0,std::ios::end);
        const auto end=input_.tellg();
        if(end<0) throw std::runtime_error("cannot determine model length");
        file_size_=static_cast<std::uint64_t>(end);
        input_.seekg(0);
        if(integer(4)!=0x46554747u) throw std::runtime_error("not GGUF");
        if(integer(4)!=3) throw std::runtime_error("unsupported GGUF version or byte order");
        tensor_count_=integer(8); metadata_count_=integer(8);
        if(tensor_count>1000000 || metadata_count>1000000) throw std::runtime_error("unreasonable header counts");
        if(!inspect) return; // Header-only mode makes no claim about the rest of the file.
        for(std::uint64_t i=0;i<metadata_count;++i) {
            auto key=string(65535);
            if(key.empty() || key.front()=='.' || key.back()=='.' || key.find("..")!=std::string::npos ||
               key.find_first_not_of("abcdefghijklmnopqrstuvwxyz0123456789_.")!=std::string::npos)
                throw std::runtime_error("invalid metadata key");
            if(metadata.count(key)) throw std::runtime_error("duplicate metadata key");
            metadata_.emplace(std::move(key),value(static_cast<std::uint32_t>(integer(4)),0));
        }
        std::uint64_t alignment=32;
        const auto aligned=metadata.find("general.alignment");
        if(aligned!=metadata.end()) {
            if(aligned->second.type!=4) throw std::runtime_error("alignment has wrong metadata type");
            alignment=aligned->second.bits;
            if(!alignment || alignment%8 || alignment>1048576) throw std::runtime_error("invalid GGUF alignment");
        }
        const auto architecture=metadata.find("general.architecture");
        if(architecture!=metadata.end() && architecture->second.type!=8)
            throw std::runtime_error("architecture has wrong metadata type");
        std::set<std::string> names;
        tensors_.reserve(static_cast<std::size_t>(tensor_count));
        for(std::uint64_t i=0;i<tensor_count;++i) {
            GgufTensor tensor;
            tensor.name=string(64);
            if(tensor.name.empty() || std::any_of(tensor.name.begin(),tensor.name.end(),
                [](unsigned char c){return c<32 || c==127;})) throw std::runtime_error("invalid tensor name");
            if(!names.insert(tensor.name).second) throw std::runtime_error("duplicate tensor name");
            const auto count=integer(4);
            if(!count || count>4) throw std::runtime_error("unsupported tensor dimensions");
            tensor.elements=1;
            for(std::uint64_t d=0;d<count;++d) {
                const auto size=integer(8);
                if(!size) throw std::runtime_error("zero tensor dimension");
                tensor.elements=product(tensor.elements,size);
                tensor.dimensions.push_back(size);
            }
            tensor.type=static_cast<std::uint32_t>(integer(4)); tensor.offset=integer(8);
            if(tensor.offset%alignment) throw std::runtime_error("unaligned tensor offset");
            const auto layout=storage(tensor.type);
            if(tensor.dimensions[0]%layout.first) throw std::runtime_error("incomplete tensor storage block");
            tensor.bytes=product(tensor.elements/layout.first,layout.second);
            tensors_.push_back(std::move(tensor));
        }
        const auto padding=(alignment-cursor_%alignment)%alignment;
        if(cursor_>std::numeric_limits<std::uint64_t>::max()-padding) throw std::runtime_error("data alignment overflow");
        data_start_=cursor_+padding;
        if(data_start>file_size_) throw std::runtime_error("truncated tensor data section");
        std::vector<const GgufTensor*> ranges;
        for(const auto& tensor:tensors) {
            const auto available=file_size_-data_start;
            if(tensor.offset>=available || tensor.bytes>available-tensor.offset)
                throw std::runtime_error("tensor byte extent outside model file");
            ranges.push_back(&tensor);
        }
        std::sort(ranges.begin(),ranges.end(),[](auto a,auto b){return a->offset<b->offset;});
        for(std::size_t i=1;i<ranges.size();++i)
            if(ranges[i]->offset<ranges[i-1]->offset+ranges[i-1]->bytes)
                throw std::runtime_error("overlapping tensor byte extents");
        inspected_=true;
    }
    const GgufTensor& tensor(const std::string& name) const {
        if(!inspected_) throw std::runtime_error("model directory was not inspected");
        for(const auto& item:tensors) if(item.name==name) return item;
        throw std::runtime_error("tensor not found");
    }
    std::vector<unsigned char> read_range(const std::string& name, std::uint64_t offset, std::uint64_t bytes) {
        const auto& item=tensor(name);
        if(offset>item.bytes || bytes>item.bytes-offset || bytes>64ull*1024*1024)
            throw std::runtime_error("tensor read exceeds validated extent or 64 MiB read limit");
        input_.clear();
        input_.seekg(static_cast<std::streamoff>(data_start+item.offset+offset));
        std::vector<unsigned char> result(static_cast<std::size_t>(bytes));
        if(!input_.read(reinterpret_cast<char*>(result.data()),static_cast<std::streamsize>(bytes)))
            throw std::runtime_error("tensor data changed or was truncated during read");
        return result;
    }
    std::vector<float> read_f32(const std::string& name) {
        const auto& item=tensor(name);
        if(item.type!=0) throw std::runtime_error("tensor is not F32; quantized decoding not connected yet");
        const auto encoded=read_range(name,0,item.bytes);
        std::vector<float> result(static_cast<std::size_t>(item.elements));
        for(std::size_t i=0;i<result.size();++i) {
            const std::uint32_t bits=std::uint32_t(encoded[4*i]) | (std::uint32_t(encoded[4*i+1])<<8) |
                (std::uint32_t(encoded[4*i+2])<<16) | (std::uint32_t(encoded[4*i+3])<<24);
            static_assert(sizeof(float)==4 && std::numeric_limits<float>::is_iec559,"IEEE F32 host required");
            std::memcpy(&result[i],&bits,4);
            if(!std::isfinite(result[i])) throw std::runtime_error("nonfinite model weight");
        }
        return result;
    }
    std::vector<float> read_weights(const std::string& name, std::uint64_t first_row=0,
                                    std::uint64_t row_count=0) {
        const auto& item=tensor(name);
        const auto width=item.dimensions[0], rows=item.elements/width;
        if(first_row>=rows) throw std::runtime_error("weight row outside tensor");
        if(!row_count) row_count=rows-first_row;
        if(row_count>rows-first_row || product(row_count,width)>16ull*1024*1024)
            throw std::runtime_error("weight rows outside tensor or decoded 64 MiB limit");
        const auto row_bytes=item.bytes/rows;
        return decode_weights(item.type,read_range(name,product(first_row,row_bytes),
                               product(row_count,row_bytes)),product(row_count,width));
    }
private:
    std::ifstream input_;
    std::uint64_t file_size_=0,cursor_=0,remaining_values_=2000000;
    bool inspected_=false;
    static std::uint64_t product(std::uint64_t a,std::uint64_t b) {
        if(b && a>std::numeric_limits<std::uint64_t>::max()/b) throw std::runtime_error("tensor dimensions or bytes overflow");
        return a*b;
    }
    static std::pair<std::uint64_t,std::uint64_t> storage(std::uint32_t type) {
        switch(type) {
            case 0:return {1,4}; case 1:case 30:return {1,2};
            case 12:return {256,144}; case 14:return {256,210};
            default:throw std::runtime_error("unsupported tensor storage type");
        }
    }
    void reserve_read(std::uint64_t bytes) const {
        if(cursor_>64ull*1024*1024 || bytes>64ull*1024*1024-cursor_)
            throw std::runtime_error("cumulative GGUF directory budget exceeded");
        if(cursor_>file_size_ || bytes>file_size_-cursor_) throw std::runtime_error("truncated GGUF directory");
    }
    std::uint64_t integer(unsigned bytes) {
        reserve_read(bytes);
        std::uint64_t bits=0;
        for(unsigned i=0;i<bytes;++i) {
            const int byte=input_.get();
            if(byte==EOF) throw std::runtime_error("truncated GGUF directory");
            bits|=std::uint64_t(static_cast<unsigned char>(byte))<<(8*i);
        }
        cursor_+=bytes;
        return bits;
    }
    std::string string(std::uint64_t limit) {
        const auto length=integer(8);
        if(length>limit) throw std::runtime_error("GGUF string exceeds reader limit");
        reserve_read(length);
        std::string result(static_cast<std::size_t>(length),'\0');
        if(!input_.read(result.data(),static_cast<std::streamsize>(length))) throw std::runtime_error("truncated GGUF string");
        cursor_+=length;
        return result;
    }
    GgufValue value(std::uint32_t type,unsigned depth) {
        if(type>=13) throw std::runtime_error("unknown GGUF metadata type");
        if(depth>8 || !remaining_values_) throw std::runtime_error("cumulative metadata value budget or nesting exceeded");
        --remaining_values_;
        GgufValue result; result.type=type;
        if(type==8) result.text=string(16*1024*1024);
        else if(type==9) {
            const auto element=static_cast<std::uint32_t>(integer(4));
            const auto count=integer(8);
            if(element>=13 || count>remaining_values_) throw std::runtime_error("metadata array type or value budget exceeded");
            const unsigned minimum[]={1,1,2,2,4,4,4,1,8,12,8,8,8};
            // Refuse impossible encoded lengths before reserving a large decoded array.
            reserve_read(product(count,minimum[element]));
            result.items.reserve(static_cast<std::size_t>(count));
            for(std::uint64_t i=0;i<count;++i) result.items.push_back(value(element,depth+1));
        } else {
            const unsigned sizes[]={1,1,2,2,4,4,4,1,0,0,8,8,8};
            result.bits=integer(sizes[type]);
            if(type==7 && result.bits>1) throw std::runtime_error("invalid metadata boolean");
        }
        return result;
    }
};
}
