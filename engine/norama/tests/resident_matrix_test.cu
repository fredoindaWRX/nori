#include "../src/gpu_engine.hpp"
#include "../src/weight_decode.hpp"
#include "../src/tensor_math.hpp"
#include <iostream>
#include <functional>

void require(bool value) {if(!value) throw std::runtime_error("resident matrix assertion failed");}
void rejects(const std::function<void()>& action) {
    bool caught=false;try{action();}catch(const std::exception&){caught=true;}require(caught);
}
std::vector<unsigned char> encoded(unsigned type,std::size_t elements) {
    const std::size_t bytes=type==0 ? elements*4 : (type==1 || type==30) ? elements*2 : elements/256*(type==12 ? 144 : 210);
    std::vector<unsigned char> data(bytes);
    if(type==0 || type==1 || type==30) {
        for(std::size_t i=0;i<elements;++i) {
            if(type==0) {
                const float x=float(int(i%31)-15)/17;unsigned bits=0;std::memcpy(&bits,&x,4);
                for(unsigned j=0;j<4;++j) data[i*4+j]=static_cast<unsigned char>(bits>>(8*j));
            } else {
                const unsigned bits=type==1 ? (i%3==0 ? 1 : i%3==1 ? 0x3c00 : 0xc000) : (i%2 ? 0xc000 : 0x3f80);
                data[i*2]=static_cast<unsigned char>(bits);data[i*2+1]=static_cast<unsigned char>(bits>>8);
            }
        }
    } else for(std::size_t b=0;b<elements/256;++b) {
        auto* p=data.data()+b*(type==12 ? 144 : 210);
        if(type==12) {
            p[1]=0x38;p[3]=0x34;
            for(unsigned i=0;i<12;++i) p[4+i]=static_cast<unsigned char>((i*37+b*11)%256);
            for(unsigned i=0;i<128;++i) p[16+i]=static_cast<unsigned char>((i*13+b*29)%256);
        } else {
            p[209]=0x38;
            for(unsigned i=0;i<208;++i) p[i]=static_cast<unsigned char>((i*17+b*31)%256);
        }
    }
    return data;
}
int main() {
    try {
        norama::GpuEngine gpu;float worst=0;
        // Exhaust EVERY finite binary16 bit pattern,including signed zeros and
        // subnormals,against the independent CPU decoder (not just common scales).
        std::vector<unsigned char> all_half;
        for(unsigned bits=0;bits<65536;++bits) if(((bits>>10)&31)!=31) {
            all_half.push_back(static_cast<unsigned char>(bits));
            all_half.push_back(static_cast<unsigned char>(bits>>8));
        }
        const auto expected_half=norama::decode_weights(1,all_half,all_half.size()/2);
        auto half_matrix=gpu.upload_matrix(1,expected_half.size(),1,[&](std::size_t o,std::size_t n){
            return std::vector<unsigned char>(all_half.begin()+o,all_half.begin()+o+n);
        });
        const auto actual_half=gpu.embedding_rows(half_matrix,{0});
        require(actual_half.size()==63488);
        for(std::size_t i=0;i<actual_half.size();++i) {
            require(actual_half[i]==expected_half[i]);
            if(expected_half[i]==0)require(std::signbit(actual_half[i])==std::signbit(expected_half[i]));
        }
        // Every format, multiple rows/blocks, batching and non-block-sized F32 columns.
        for(unsigned type:{0u,1u,30u,12u,14u}) {
            const std::size_t rows=7,columns=type==0 ? 513 : 512,tokens=3;
            auto bytes=encoded(type,rows*columns);auto matrix=norama::decode_weights(type,bytes,rows*columns);
            auto resident=gpu.upload_matrix(rows,columns,type,[&](std::size_t o,std::size_t n){return std::vector<unsigned char>(bytes.begin()+o,bytes.begin()+o+n);});
            require(resident.byte_size()==bytes.size());std::vector<float> input(tokens*columns);
            const auto embedded=gpu.embedding_rows(resident,{6,0,6});
            for(std::size_t t=0;t<3;++t) for(std::size_t c=0;c<columns;++c)
                require(embedded[t*columns+c]==matrix[(t==1 ? 0 : 6)*columns+c]);
            rejects([&]{gpu.embedding_rows(resident,{});});
            rejects([&]{gpu.embedding_rows(resident,{7});});
            for(std::size_t i=0;i<input.size();++i) input[i]=float(int(i%13)-6)/19;
            auto actual=gpu.multiply(resident,input,tokens);
            for(std::size_t token=0;token<tokens;++token) {
                const std::vector<float> row(input.begin()+token*columns,input.begin()+(token+1)*columns);
                auto expected=norama::matvec(matrix,rows,row);
                for(std::size_t r=0;r<rows;++r) {
                    const auto error=std::abs(actual[token*rows+r]-expected[r]);worst=std::max(worst,error);
                    require(error<=1e-3f+std::abs(expected[r])*2e-5f);
                }
            }
            // Basis inputs expose each decoded weight exactly, not just an aggregate dot product.
            for(std::size_t first=0;first<columns;first+=128) {
                const auto count=std::min(std::size_t(128),columns-first);
                std::vector<float> basis(count*columns,0);
                for(std::size_t i=0;i<count;++i) basis[i*columns+first+i]=1;
                auto decoded=gpu.multiply(resident,basis,count);
                for(std::size_t t=0;t<count;++t) for(std::size_t r=0;r<rows;++r)
                    require(decoded[t*rows+r]==matrix[r*columns+first+t]);
            }
            rejects([&]{gpu.multiply(resident,input,0);});
            rejects([&]{gpu.multiply(resident,input,129);});
            rejects([&]{gpu.multiply(resident,{1},1);});
            rejects([&]{gpu.multiply(resident,std::vector<float>(columns,std::numeric_limits<float>::quiet_NaN()),1);});
            auto moved=std::move(resident);require(resident.byte_size()==0);
            rejects([&]{gpu.multiply(resident,input,tokens);});
            require(gpu.multiply(moved,input,tokens)==actual);
            // Full upload validation must reject even a nonfinite weight not used by a basis input.
            if(type==0) {bytes[bytes.size()-4]=0;bytes[bytes.size()-3]=0;bytes[bytes.size()-2]=0x80;bytes.back()=0x7f;}
            else if(type==1 || type==30) {bytes[bytes.size()-2]=0;bytes.back()=type==1 ? 0x7c : 0x7f; if(type==30) bytes[bytes.size()-2]=0x80;}
            else bytes[type==12 ? 1 : 209]=0x7c;
            rejects([&]{gpu.upload_matrix(rows,columns,type,[&](std::size_t o,std::size_t n){return std::vector<unsigned char>(bytes.begin()+o,bytes.begin()+o+n);});});
        }
        auto reader=[](std::size_t,std::size_t n){return std::vector<unsigned char>(n,0);};
        rejects([&]{gpu.upload_matrix(0,1,0,reader);});
        rejects([&]{gpu.upload_matrix(1,513,12,reader);});
        rejects([&]{gpu.upload_matrix(1,1,99,reader);});
        const auto before=gpu.available_bytes();
        for(unsigned i=0;i<8;++i) rejects([&]{gpu.upload_matrix(7,512,12,[](auto,auto){throw std::runtime_error("reader cancelled");return std::vector<unsigned char>{};});});
        require(gpu.available_bytes()>=before);
        rejects([&]{gpu.upload_matrix(1,1,0,[](auto,auto){return std::vector<unsigned char>{};});});
        const std::vector<float> input={1,2,3,4,5,6},norm={1,2,3};
        const auto normal=gpu.normalize_batch(input,norm,1e-5f,2);
        for(std::size_t t=0;t<2;++t) {
            const auto expected=norama::rms_norm(std::vector<float>(input.begin()+t*3,input.begin()+(t+1)*3),norm,1e-5f);
            for(std::size_t i=0;i<3;++i) require(std::abs(normal[t*3+i]-expected[i])<2e-6);
        }
        rejects([&]{gpu.normalize_batch(input,norm,0,2);});
        rejects([&]{gpu.normalize_batch(input,norm,1e-5f,0);});
        rejects([&]{gpu.normalize_batch(input,norm,1e-5f,3);});
        std::cout<<"Resident F32/F16/BF16/Q4_K/Q6_K: exact decoded basis,batched CPU comparison,validation,moves,cancel cleanup,norm passed; max dot error="<<worst<<'\n';
        return 0;
    }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}
