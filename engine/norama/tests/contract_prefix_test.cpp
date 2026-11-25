#include "../src/contract_prefix.hpp"
#include "../src/json_decode.hpp"
#include <iostream>

void require(bool value) {if(!value) throw std::runtime_error("Contract prefix regression");}
std::string unhex(const std::string& line) {
    if(line.size()>524288 || line.size()%2) throw std::runtime_error("invalid grammar hex fixture size");
    const auto nibble=[](char c)->unsigned {
        if(c>='0' && c<='9') return c-'0';if(c>='a' && c<='f') return c-'a'+10;
        throw std::runtime_error("invalid grammar hex fixture");
    };
    std::string bytes;for(std::size_t i=0;i<line.size();i+=2) bytes.push_back(char(nibble(line[i])*16+nibble(line[i+1])));
    return bytes;
}
std::string exact(const std::string& text) {
    using norama::wire::put;
    std::string bytes="NGM2";put(bytes,text.size()+1,4);put(bytes,text.size(),4);put(bytes,0,4);put(bytes,text.size(),4);put(bytes,0,4);
    for(std::size_t i=0;i<text.size();++i) {put(bytes,i,4);put(bytes,i+1,4);put(bytes,static_cast<unsigned char>(text[i]),2);}
    return bytes;
}
int main(int argc,char** argv) {
    try {
        if(argc==2 && std::string(argv[1])=="--classify-contract-lines") {
            std::string line;if(!std::getline(std::cin,line)) throw std::runtime_error("grammar fixture required");
            const auto program=std::make_shared<norama::ContractProgram>(unhex(line));
            while(std::getline(std::cin,line)) {
                norama::ContractPrefix state(program);state.append(unhex(line));
                std::cout<<(state.complete() ? 'C' : state.valid() ? 'P' : 'I')<<'\n';
            }
            return 0;
        }
        if(argc!=1) throw std::runtime_error("unknown contract prefix test argument");
        auto program=std::make_shared<norama::ContractProgram>(exact("{\"status\":\"blocked\"}"));
        norama::ContractPrefix state(program);require(state.append("{\"status\":"));
        auto trial=state;require(!trial.append("\"succeeded\"}"));
        require(state.append("\"blocked\"}"));require(state.complete());
        require(!state.append("x"));
        norama::ContractPrefix selection(program);
        const std::vector<std::string> tokens={"{\"wrong\":", "{\"status\":", "\"succeeded\"}", "\"blocked\"}",""};
        const auto decode=[&](auto id){return tokens.at(id);};const auto stop=[](auto id){return id==4;};
        require(norama::json_greedy_token({10,9,8,7,11},selection,decode,stop)==1);
        require(norama::json_greedy_token({0,1,10,9,8},selection,decode,stop)==3);require(selection.complete());
        for(const auto bytes:{std::string("bad"),exact("{}").substr(0,21),exact("{}")+"x"}) {
            bool refused=false;try {norama::ContractProgram invalid(bytes);} catch(const std::runtime_error&) {refused=true;}
            require(refused);
        }
        auto bad=exact("{}");bad[24]=char(255);bool refused=false;
        try {norama::ContractProgram invalid(bad);}catch(const std::runtime_error&){refused=true;}require(refused);
        // No accepting path and invalid symbol fail before decoding.
        bad=exact("{}");bad[16]=0;bad[17]=0;bad[18]=0;bad[19]=0; //start=end is allowed but JSON intersection still required.
        norama::ContractPrefix empty(std::make_shared<norama::ContractProgram>(bad));require(!empty.complete());
        bad=exact("{}");bad[32]=char(255);bad[33]=char(255);refused=false;
        try {norama::ContractProgram invalid(bad);}catch(const std::runtime_error&){refused=true;}require(refused);
        std::cout<<"Own contract prefix and decode selection tests PASS\n";return 0;
    }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}
