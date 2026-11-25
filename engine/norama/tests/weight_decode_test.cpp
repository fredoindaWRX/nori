#include "../src/weight_decode.hpp"
#include <array>
#include <iostream>
#include <functional>

void require(bool condition) { if(!condition) throw std::runtime_error("weight decoder assertion failed"); }
void rejects(const std::function<void()>& operation) {
    bool rejected=false;
    try { operation(); } catch(const std::runtime_error&) { rejected=true; }
    require(rejected);
}
int main() {
    try {
        require(norama::binary16(0x3c00)==1 && norama::binary16(0xc000)==-2);
        require(norama::binary16(1)==std::ldexp(1.f,-24));
        require(norama::binary16(0x7bff)==65504 && std::signbit(norama::binary16(0x8000)));
        rejects([]{norama::binary16(0x7c00);});
        rejects([]{norama::binary16(0x7fff);});
        const auto half=norama::decode_weights(1,{0,0x3c,0,0xc0,1,0},3);
        require(half[0]==1 && half[1]==-2 && half[2]==std::ldexp(1.f,-24));
        require(norama::decode_weights(30,{0x80,0x3f,0,0xc0},2)==std::vector<float>({1,-2}));
        require(norama::decode_weights(0,{0,0,0xc0,0x3f},1)[0]==1.5f);
        rejects([]{norama::decode_weights(30,{0x80,0x7f},1);});
        rejects([]{norama::decode_weights(0,{0,0,0x80,0x7f},1);});
        rejects([]{norama::decode_weights(99,{},0);});
        rejects([]{norama::decode_weights(12,std::vector<unsigned char>(143),256);});
        rejects([]{norama::decode_weights(14,std::vector<unsigned char>(210),255);});
        rejects([]{norama::decode_weights(0,{},16ull*1024*1024+1);});
        // Independently pack known logical scales/minima, including every high-bit field.
        std::vector<unsigned char> q4(288);
        const std::array<unsigned,8> scales={0,15,32,63,48,17,33,62};
        const std::array<unsigned,8> minima={63,0,17,48,32,62,15,33};
        for(unsigned block=0;block<2;++block) {
            auto* p=q4.data()+block*144;
            p[1]=0x38; p[3]=0x34; // d=0.5, dmin=0.25
            for(unsigned g=0;g<8;++g) {
                if(g<4) { p[4+g]|=scales[g]; p[8+g]|=minima[g]; }
                else { p[12+g-4]|=(scales[g]&15)|((minima[g]&15)<<4);
                       p[4+g-4]|=(scales[g]>>4)<<6; p[8+g-4]|=(minima[g]>>4)<<6; }
                for(unsigned lane=0;lane<32;++lane) {
                    const unsigned q=(g*3+lane+block)%16;
                    p[16+(g/2)*32+lane]|=q<<(4*(g%2));
                }
            }
        }
        const auto decoded4=norama::decode_weights(12,q4,512);
        for(unsigned i=0;i<512;++i) {
            const unsigned g=(i%256)/32, lane=i%32, block=i/256;
            require(decoded4[i]==0.5f*scales[g]*((g*3+lane+block)%16)-0.25f*minima[g]);
        }
        std::vector<unsigned char> q6(420);
        for(unsigned block=0;block<2;++block) {
            auto* p=q6.data()+block*210; p[209]=0x38;
            for(unsigned g=0;g<16;++g) p[192+g]=static_cast<unsigned char>(int(g)*17-128);
            for(unsigned i=0;i<256;++i) {
                const unsigned tile=i/128, group=(i%128)/32, lane=i%32;
                const unsigned q=(i*7+block)%64;
                p[tile*64+(group%2)*32+lane]|=(q&15)<<(4*(group/2));
                p[128+tile*32+lane]|=(q>>4)<<(2*group);
            }
        }
        const auto decoded6=norama::decode_weights(14,q6,512);
        for(unsigned i=0;i<512;++i)
            require(decoded6[i]==0.5f*(int((i%256)/16)*17-128)*(int((i*7+i/256)%64)-32));
        q4[1]=0x7c;
        rejects([&]{norama::decode_weights(12,q4,512);});
        q6[209]=0x7c;
        rejects([&]{norama::decode_weights(14,q6,512);});
        std::cout << "Own weight decoder: F32/F16/BF16,512 Q4_K and512 Q6_K analytic values; bounds/nonfinite checks passed\n";
    } catch(const std::exception& error) {std::cerr<<error.what()<<'\n';return 1;}
}
