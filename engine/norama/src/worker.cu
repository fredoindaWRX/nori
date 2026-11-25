#include "worker_protocol.hpp"
#include "resident_graph.hpp"
#include "tokenizer.hpp"
#include "json_decode.hpp"
#include "contract_prefix.hpp"
#include <condition_variable>
#include <thread>
#include <chrono>
#include <iostream>
#include <io.h>
#include <fcntl.h>

namespace {
struct Cancelled:std::exception {};
struct Request {norama::wire::Frame frame;std::atomic<bool> cancelled{false};};
struct Inbox {
    std::mutex mutex;std::condition_variable wake;
    std::shared_ptr<Request> pending,active;
    std::atomic<bool> shutdown{false};
};
void receive(Inbox& inbox,norama::wire::Writer& writer) {
    using namespace norama::wire;
    std::uint32_t last_id=0;
    try {
        Frame frame{};
        while(read(std::cin,frame)) {
            if(frame.kind==shutdown) {
                if(frame.id || !frame.payload.empty()) throw std::runtime_error("invalid worker shutdown");
                break;
            }
            if(frame.kind==cancel) {
                if(!frame.id || !frame.payload.empty()) throw std::runtime_error("invalid worker cancellation");
                std::lock_guard<std::mutex> lock(inbox.mutex);
                if(inbox.active && inbox.active->frame.id==frame.id) inbox.active->cancelled=true;
                if(inbox.pending && inbox.pending->frame.id==frame.id) inbox.pending->cancelled=true;
                continue;
            }
            if((frame.kind!=chat && frame.kind!=json_chat && frame.kind!=contract_chat) || !frame.id || frame.id<=last_id) throw std::runtime_error("invalid worker request sequence");
            last_id=frame.id;
            auto request=std::make_shared<Request>();request->frame=std::move(frame);
            {
                std::lock_guard<std::mutex> lock(inbox.mutex);
                if(inbox.pending) {writer.send(error,request->frame.id,"worker admission busy");continue;}
                inbox.pending=std::move(request);
            }
            inbox.wake.notify_one();
        }
    }catch(const std::exception& e){writer.send(error,0,e.what());}
    inbox.shutdown=true;
    {std::lock_guard<std::mutex> lock(inbox.mutex);if(inbox.active) inbox.active->cancelled=true;}
    inbox.wake.notify_one();
}
}
int wmain(int argc,wchar_t** argv) {
    using namespace norama::wire;
    try {
        if(argc!=2) throw std::runtime_error("usage: norama-worker MODEL");
        if(_setmode(_fileno(stdin),_O_BINARY)==-1 || _setmode(_fileno(stdout),_O_BINARY)==-1)
            throw std::runtime_error("worker binary pipe mode failed");
        std::cin.tie(nullptr); // Input thread must not flush another thread's framed stdout.
        const auto path=norama::utf8(reinterpret_cast<const char16_t*>(argv[1]),std::wcslen(argv[1]));
        norama::GgufFile file(path);norama::GgufTokenizer tokenizer(file);norama::GpuEngine gpu;norama::ResidentGraph graph(file,gpu);
        Writer writer(std::cout);std::string hello;put(hello,graph.resident_bytes(),8);put(hello,2048,4);put(hello,2048,4);hello+=gpu.device_name();
        writer.send(ready,0,hello);
        Inbox inbox;std::thread reader(receive,std::ref(inbox),std::ref(writer));
        while(true) {
            std::shared_ptr<Request> request;
            {
                std::unique_lock<std::mutex> lock(inbox.mutex);
                inbox.wake.wait(lock,[&]{return inbox.shutdown || inbox.pending;});
                if(inbox.shutdown) break;
                request=std::move(inbox.pending);inbox.active=request;
            }
            const auto id=request->frame.id;
            const auto check=[&]{if(request->cancelled || inbox.shutdown || writer.failed) throw Cancelled{};};
            const auto cancellation=[&]{check();return false;};
            try {
                check();std::unique_ptr<norama::ContractPrefix> contract;
                std::string chat_bytes=request->frame.payload;
                if(request->frame.kind==contract_chat) {
                    std::size_t at=0;const auto length=take(chat_bytes,at,4);
                    if(length>196608 || length>chat_bytes.size()-at) throw std::runtime_error("invalid contract-chat program length");
                    contract=std::make_unique<norama::ContractPrefix>(
                        std::make_shared<norama::ContractProgram>(chat_bytes.substr(at,std::size_t(length))));
                    chat_bytes=chat_bytes.substr(at+std::size_t(length));
                }
                const auto body=parse_chat(chat_bytes);
                std::vector<norama::GgufTokenizer::Message> messages;
                for(const auto& item:body.messages) messages.push_back({item.role,item.content});
                const auto prompt=tokenizer.chat_prompt(messages);
                if(prompt.size()>2048) throw std::runtime_error("worker prompt exceeds2048 tokens");
                check();auto session=graph.create_session(prompt.size()+body.limit,1024ull*1024*1024,cancellation);
                const auto start=std::chrono::steady_clock::now();std::vector<float> scores;
                for(std::size_t first=0;first<prompt.size();first+=128) {
                    check();const auto end=std::min(prompt.size(),first+128);
                    scores=graph.append(session,std::vector<std::uint32_t>(prompt.begin()+first,prompt.begin()+end),cancellation);
                }
                std::vector<std::uint32_t> output;unsigned char reason=2;
                const bool json=request->frame.kind==json_chat || bool(contract);norama::JsonObjectPrefix prefix;
                const auto decode=[&](std::uint32_t token_id){return tokenizer.decode_bytes(std::vector<std::uint32_t>{token_id});};
                const auto stop=[&](std::uint32_t token_id){return tokenizer.is_stop(token_id);};
                const auto completed=[&]{return contract ? contract->complete() : prefix.complete();};
                for(unsigned step=0;step<body.limit;++step) {
                    check();
                    const auto next=contract ? norama::json_greedy_token(scores,*contract,decode,stop,cancellation) :
                        json ? norama::json_greedy_token(scores,prefix,decode,stop,cancellation) : norama::greedy_token(scores);
                    if(tokenizer.is_stop(next)){reason=1;break;}
                    output.push_back(next);writer.send(token,id,tokenizer.decode_bytes({next}));
                    if(json && completed()){reason=1;break;}
                    if(step+1<body.limit) scores=graph.append(session,{next},cancellation);
                }
                if(json && !completed()) throw std::runtime_error("JSON-object generation exhausted output budget before completion");
                check();(void)tokenizer.decode_text(output); // An incomplete UTF8 suffix is an error,not replacement text.
                std::string stats;put(stats,output.size(),4);put(stats,prompt.size(),4);
                const double seconds=std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count();
                std::uint64_t bits=0;std::memcpy(&bits,&seconds,8);put(stats,bits,8);stats.push_back(char(reason));
                writer.send(metrics,id,stats);writer.send(done,id);
            }catch(const Cancelled&){writer.send(cancelled,id);}
            catch(const std::exception& e){writer.send(error,id,std::string(e.what()).substr(0,16384));}
            {std::lock_guard<std::mutex> lock(inbox.mutex);inbox.active.reset();}
        }
        reader.join();return writer.failed ? 1 : 0;
    }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}
}
