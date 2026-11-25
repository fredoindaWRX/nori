#pragma once
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <stdexcept>
#include <vector>

namespace norama {
// Our byte-indexed compatibility decoder, not a linked inference backend.
// Serialized layouts: https://github.com/ggml-org/ggml/blob/master/src/ggml-common.h
inline float binary16(std::uint16_t bits) {
    const unsigned exponent=(bits>>10)&31, fraction=bits&1023;
    if(exponent==31) throw std::runtime_error("nonfinite model weight");
    const float magnitude=exponent ? std::ldexp(float(1024+fraction),int(exponent)-25)
                                   : std::ldexp(float(fraction),-24);
    return bits&32768 ? -magnitude : magnitude;
}
inline std::uint16_t weight_u16(const unsigned char* p) {
    return std::uint16_t(p[0]) | (std::uint16_t(p[1])<<8);
}
inline std::vector<float> decode_weights(std::uint32_t type,
                                        const std::vector<unsigned char>& bytes,
                                        std::uint64_t elements) {
    // Limit expanded output as well as input: compressed bytes aren't a memory budget.
    if(elements>16ull*1024*1024) throw std::runtime_error("decoded weights exceed 64 MiB limit");
    std::uint64_t block=1, size=0;
    switch(type) {
        case 0:size=4;break;
        case 1:case 30:size=2;break;
        case 12:block=256;size=144;break;
        case 14:block=256;size=210;break;
        default:throw std::runtime_error("unsupported weight decoding type");
    }
    if(elements%block || bytes.size()!=(elements/block)*size)
        throw std::runtime_error("weight byte count or block alignment mismatch");
    static_assert(sizeof(float)==4 && std::numeric_limits<float>::is_iec559,"IEEE F32 host required");
    std::vector<float> result(static_cast<std::size_t>(elements));
    std::size_t cached_block=std::numeric_limits<std::size_t>::max();
    float block_scale=0, block_minimum=0;
    for(std::size_t i=0;i<result.size();++i) {
        float value=0;
        if(type==0 || type==30) {
            const auto* p=bytes.data()+i*size;
            std::uint32_t bits=type==30 ? std::uint32_t(weight_u16(p))<<16
                : std::uint32_t(p[0]) | (std::uint32_t(p[1])<<8) |
                  (std::uint32_t(p[2])<<16) | (std::uint32_t(p[3])<<24);
            std::memcpy(&value,&bits,4);
        } else if(type==1) value=binary16(weight_u16(bytes.data()+2*i));
        else {
            const auto* p=bytes.data()+(i/256)*size;
            if(cached_block!=i/256) {
                cached_block=i/256;
                block_scale=binary16(weight_u16(p+(type==14 ? 208 : 0)));
                block_minimum=type==12 ? binary16(weight_u16(p+2)) : 0;
            }
            const unsigned local=unsigned(i%256);
            if(type==12) {
                const unsigned group=local/32, lane=local%32;
                const auto* s=p+4;
                const unsigned scale=group<4 ? s[group]&63
                    : (s[group+4]&15)|((s[group-4]>>6)<<4);
                const unsigned minimum=group<4 ? s[group+4]&63
                    : (s[group+4]>>4)|((s[group]>>6)<<4);
                const unsigned quant=(p[16+(group/2)*32+lane]>>(4*(group%2)))&15;
                value=(block_scale*float(scale))*float(quant)-block_minimum*float(minimum);
            } else {
                const unsigned tile=local/128, group=(local%128)/32, lane=local%32;
                const unsigned low=(p[tile*64+(group%2)*32+lane]>>(4*(group/2)))&15;
                const unsigned high=(p[128+tile*32+lane]>>(2*group))&3;
                const unsigned raw_scale=p[192+tile*8+group*2+lane/16];
                const int scale=raw_scale<128 ? int(raw_scale) : int(raw_scale)-256;
                const int quant=int(low|(high<<4))-32;
                value=(block_scale*float(scale))*float(quant);
            }
        }
        if(!std::isfinite(value)) throw std::runtime_error("nonfinite model weight");
        result[i]=value;
    }
    return result;
}
}
