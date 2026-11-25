#include "dualtrace_gpu.cuh"
#include "worker_protocol.hpp"
#include <chrono>
#include <condition_variable>
#include <thread>
#include <memory>
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
void valid_utf8(const std::string& text) {
    if(!text.empty() && !MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,text.data(),int(text.size()),nullptr,0))
        throw std::runtime_error("DualTrace text is not valid UTF8");
}
std::vector<unsigned> prompt(const norama::wire::Chat& body) {
    if(body.limit>256)throw std::runtime_error("DualTrace output limit256");
    std::string text;
    for(const auto& message:body.messages) {
        valid_utf8(message.content);
        // Explicit development framing, not an instruction-trained template.
        text+='[';text+=message.role;text+="]\n";text+=message.content;text+='\n';
        if(text.size()>511)throw std::runtime_error("DualTrace byte prompt bound");
    }
    text+="[assistant]\n";
    if(1+text.size()+body.limit>512)throw std::runtime_error("DualTrace total session limit512");
    std::vector<unsigned> tokens{256};
    for(unsigned char byte:text)tokens.push_back(byte);
    return tokens;
}
void receive(Inbox& inbox,norama::wire::Writer& writer) {
    using namespace norama::wire;std::uint32_t last_id=0;
    try {
        Frame frame{};
        while(read(std::cin,frame)) {
            if(frame.kind==norama::wire::shutdown) {
                if(frame.id || !frame.payload.empty())throw std::runtime_error("invalid worker shutdown");
                break;
            }
            if(frame.kind==cancel) {
                if(!frame.id || !frame.payload.empty())throw std::runtime_error("invalid worker cancellation");
                std::lock_guard<std::mutex> lock(inbox.mutex);
                if(inbox.active && inbox.active->frame.id==frame.id)inbox.active->cancelled=true;
                if(inbox.pending && inbox.pending->frame.id==frame.id)inbox.pending->cancelled=true;
                continue;
            }
            if(frame.kind!=chat || !frame.id || frame.id<=last_id)throw std::runtime_error("unsupported DualTrace request or sequence");
            last_id=frame.id;auto request=std::make_shared<Request>();request->frame=std::move(frame);
            {
                std::lock_guard<std::mutex> lock(inbox.mutex);
                if(inbox.pending){writer.send(error,request->frame.id,"worker admission busy");continue;}
                inbox.pending=std::move(request);
            }
            inbox.wake.notify_one();
        }
    }catch(const std::exception& e){writer.send(error,0,e.what());}
    inbox.shutdown=true;
    {std::lock_guard<std::mutex> lock(inbox.mutex);if(inbox.active)inbox.active->cancelled=true;}
    inbox.wake.notify_one();
}
}
int wmain(int argc,wchar_t** argv) {
    using namespace norama::wire;
    try {
        if(argc!=2)throw std::runtime_error("usage: norama-dualtrace-worker MODEL.ndt");
        if(_setmode(_fileno(stdin),_O_BINARY)==-1 || _setmode(_fileno(stdout),_O_BINARY)==-1)
            throw std::runtime_error("worker binary pipe mode failed");
        std::cin.tie(nullptr);
        norama::dualtrace::Model model{std::filesystem::path(argv[1])};
        norama::dualtrace::Gpu graph(model);
        Writer writer(std::cout);std::string hello;
        put(hello,graph.resident_bytes(),8);put(hello,512,4);put(hello,256,4);
        hello+="NDT0";hello+=graph.device_name;writer.send(ready,0,hello);
        Inbox inbox;std::thread reader(receive,std::ref(inbox),std::ref(writer));
        while(true) {
            std::shared_ptr<Request> request;
            {
                std::unique_lock<std::mutex> lock(inbox.mutex);
                inbox.wake.wait(lock,[&]{return inbox.shutdown || inbox.pending;});
                if(inbox.shutdown)break;
                request=std::move(inbox.pending);inbox.active=request;
            }
            const auto id=request->frame.id;
            const auto check=[&]{if(request->cancelled || inbox.shutdown || writer.failed)throw Cancelled{};};
            try {
                check();const auto body=parse_chat(request->frame.payload);const auto input=prompt(body);
                graph.reset();const auto start=std::chrono::steady_clock::now();std::vector<float> scores;
                for(auto token_id:input){check();scores=graph.step(token_id);}
                std::string output;unsigned char reason=2;
                for(unsigned i=0;i<body.limit;++i) {
                    check();const auto next=unsigned(std::max_element(scores.begin(),scores.end())-scores.begin());
                    if(next==257){reason=1;break;}
                    if(next==256)throw std::runtime_error("unexpected BOS generation");
                    const std::string byte(1,char(next));output+=byte;writer.send(token,id,byte);
                    if(i+1<body.limit)scores=graph.step(next);
                }
                check();valid_utf8(output); // No replacement text or fake DONE for invalid UTF8.
                std::string stats;put(stats,output.size(),4);put(stats,input.size(),4);
                const double seconds=std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count();
                std::uint64_t bits=0;std::memcpy(&bits,&seconds,8);put(stats,bits,8);stats.push_back(char(reason));
                writer.send(metrics,id,stats);writer.send(done,id);
            }catch(const Cancelled&){writer.send(cancelled,id);}
            catch(const std::exception& e){writer.send(error,id,std::string(e.what()).substr(0,16384));}
            {std::lock_guard<std::mutex> lock(inbox.mutex);inbox.active.reset();}
        }
        reader.join();return writer.failed?1:0;
    }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}
}
