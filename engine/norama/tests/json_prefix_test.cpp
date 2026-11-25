#include "../src/json_prefix.hpp"
#include "../src/json_decode.hpp"
#include <iostream>
#include <stdexcept>

void require(bool value) {if(!value) throw std::runtime_error("JSON prefix regression");}
int main(int argc,char** argv) {
    try {
        if(argc==2 && std::string(argv[1])=="--classify-lines") {
            std::string line;
            while(std::getline(std::cin,line)) {
                if(line.size()>524288 || line.size()%2) throw std::runtime_error("hex fixture bounds");
                std::string bytes;
                const auto hex=[](char c)->unsigned {
                    if(c>='0' && c<='9') return c-'0';
                    if(c>='a' && c<='f') return c-'a'+10;
                    throw std::runtime_error("invalid hex fixture");
                };
                for(std::size_t i=0;i<line.size();i+=2) bytes.push_back(char(hex(line[i])*16+hex(line[i+1])));
                norama::JsonObjectPrefix state;state.append(bytes);
                std::cout<<(state.complete() ? 'C' : state.valid() ? 'P' : 'I')<<'\n';
            }
            return 0;
        }
        if(argc!=1) throw std::runtime_error("unknown JSON prefix test option");
        for(const std::string text:{"{}"," {\"x\":[true,false,null,-12.25e+3,{},[]]}\n",
                "{\"x\":\"\\uD83D\\uDE42\"}"}) {
            norama::JsonObjectPrefix state;
            for(char c:text) require(state.append(std::string(1,c)));
            require(state.complete());
        }
        for(const std::string text:{"[]","null","{x:0}","{\"x\":01}","{\"x\":-}",
                "{\"x\":1.}","{\"x\":1e+}","{\"x\":NaN}","{\"x\":true,}","{}{}",
                "{\"x\":[1,]}","{\"x\":\"\\q\"}","{\"x\":\"\\ud800x\"}",
                "{\"x\":\"\\udc00\"}","{\"x\":\"\\ud800\\u0041\"}"}) {
            norama::JsonObjectPrefix state;require(!state.append(text));require(!state.complete());
        }
        norama::JsonObjectPrefix original;require(original.append("{\"x\":"));
        auto trial=original;require(!trial.append("undefined}"));
        require(original.append("1}"));require(original.complete());
        norama::JsonObjectPrefix depth;require(depth.append("{"));
        for(unsigned i=0;i<31;++i) require(depth.append("\"x\":{"));
        require(!depth.append("\"x\":{"));
        norama::JsonObjectPrefix budget;require(budget.append(std::string(262144,' ')));
        require(!budget.append("{"));
        const std::vector<std::string> tokens={"```json","{\"x\":","}","1}","", "{} prose"};
        const auto decode=[&](auto id){return tokens.at(id);};
        const auto stop=[](auto id){return id==4;};
        norama::JsonObjectPrefix selected;
        require(norama::json_greedy_token({9,8,7,6,10,11},selected,decode,stop)==1);
        // The top-scoring closing brace is illegal here; choose the full valid
        // number token, and verify whole-token trailing prose was rejected.
        require(norama::json_greedy_token({0,1,10,9,8,7},selected,decode,stop)==3);
        require(selected.complete());
        const std::vector<std::string> unicode_tokens={std::string("\xf0\x9f",2),"\"}",std::string("\x99\x82\"}",4)};
        norama::JsonObjectPrefix split;require(split.append("{\"x\":\""));
        const auto unicode_decode=[&](auto id){return unicode_tokens.at(id);};
        const auto ordinary=[](auto){return false;};
        require(norama::json_greedy_token({9,8,7},split,unicode_decode,ordinary)==0);
        require(norama::json_greedy_token({8,10,9},split,unicode_decode,ordinary)==2);
        require(split.complete());
        for(unsigned which=0;which<3;++which) {
            norama::JsonObjectPrefix state;bool refused=false;
            try {
                if(which==0) norama::json_greedy_token({1},state,[](auto){return std::string("[]");},[](auto){return false;});
                if(which==1) norama::json_greedy_token({NAN},state,decode,stop);
                if(which==2) norama::json_greedy_token({1},state,decode,stop,[]{return true;});
            } catch(const std::exception&){refused=true;}
            require(refused);require(state.byte_count()==0);
        }
        std::cout<<"Own JSON-object prefix guard:syntax,nesting,numbers,escapes,surrogates,copy isolation,resource bounds PASS;not schema or semantic qualification\n";
        return 0;
    }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}
}
