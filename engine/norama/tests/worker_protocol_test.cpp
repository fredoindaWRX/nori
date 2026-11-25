#include "../src/worker_protocol.hpp"
#include <sstream>
#include <functional>
#include <iostream>
using namespace norama::wire;
void require(bool x){if(!x)throw std::runtime_error("worker protocol assertion failed");}
void rejects(const std::function<void()>& f){bool caught=false;try{f();}catch(const std::exception&){caught=true;}require(caught);}
int main(){try {
    std::ostringstream output;Writer writer(output);const std::string bytes("hi\0\r\n",5);writer.send(token,19,bytes);
    std::istringstream input(output.str());Frame frame{};require(read(input,frame));require(frame.kind==token && frame.id==19 && frame.payload==bytes);
    require(!read(input,frame));
    for(std::size_t length=1;length<output.str().size();++length){std::istringstream cut(output.str().substr(0,length));rejects([&]{read(cut,frame);});}
    std::string header="NOPE";header.push_back(char(chat));put(header,1,4);put(header,0,4);
    std::istringstream wrong(header);rejects([&]{read(wrong,frame);});
    header.replace(0,4,"NRW1");header.resize(9);put(header,maximum_payload+1,4);std::istringstream big(header);rejects([&]{read(big,frame);});
    std::string payload;put(payload,4,4);put(payload,1,4);payload.push_back(2);put(payload,5,4);payload+=bytes;
    const auto parsed=parse_chat(payload);require(parsed.limit==4 && parsed.messages[0].role=="user" && parsed.messages[0].content==bytes);
    for(std::size_t n=0;n<payload.size();++n)rejects([&]{parse_chat(payload.substr(0,n));});
    rejects([&]{parse_chat(payload+"junk");});payload[8]=0;rejects([&]{parse_chat(payload);});
    payload[8]=2;payload[0]=0;rejects([&]{parse_chat(payload);});
    std::cout<<"Own worker frame protocol: binary roundtrip,EOF/truncation,magic/byte bounds,message/count/role/limit checks pass\n";return 0;
}catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
