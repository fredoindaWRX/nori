#pragma once
#include <cstdint>
#include <string>
#include <vector>
#include <istream>
#include <ostream>
#include <stdexcept>
#include <mutex>
#include <atomic>

namespace norama::wire {
constexpr std::size_t maximum_payload=262144;
enum Kind:unsigned char {chat=1,cancel=2,shutdown=3,json_chat=4,contract_chat=5,ready=16,token=17,metrics=18,done=19,error=20,cancelled=21};
struct Frame {unsigned char kind;std::uint32_t id;std::string payload;};
inline void put(std::string& target,std::uint64_t value,unsigned bytes) {
    for(unsigned i=0;i<bytes;++i) target.push_back(char((value>>(8*i))&255));
}
inline std::uint64_t take(const std::string& source,std::size_t& offset,unsigned bytes) {
    if(offset>source.size() || bytes>source.size()-offset) throw std::runtime_error("truncated worker payload");
    std::uint64_t result=0;for(unsigned i=0;i<bytes;++i) result|=std::uint64_t(static_cast<unsigned char>(source[offset++]))<<(8*i);
    return result;
}
inline bool read(std::istream& stream,Frame& frame) {
    char header[13];stream.read(header,13);
    if(stream.gcount()==0 && stream.eof()) return false;
    if(stream.gcount()!=13 || std::string(header,4)!="NRW1") throw std::runtime_error("invalid worker frame header");
    const std::string bytes(header,13);std::size_t at=5;
    frame.kind=static_cast<unsigned char>(header[4]);frame.id=std::uint32_t(take(bytes,at,4));
    const auto length=take(bytes,at,4);
    if(length>maximum_payload) throw std::runtime_error("worker frame exceeds byte budget");
    frame.payload.assign(std::size_t(length),'\0');
    if(length && !stream.read(frame.payload.data(),std::streamsize(length))) throw std::runtime_error("truncated worker frame");
    return true;
}
class Writer {
    std::ostream& stream_;std::mutex mutex_;
public:
    std::atomic<bool> failed{false};
    explicit Writer(std::ostream& stream):stream_(stream) {}
    void send(unsigned char kind,std::uint32_t id,const std::string& payload={}) {
        std::lock_guard<std::mutex> lock(mutex_);
        if(payload.size()>maximum_payload){failed=true;return;}
        std::string header="NRW1";header.push_back(char(kind));put(header,id,4);put(header,payload.size(),4);
        stream_.write(header.data(),header.size());stream_.write(payload.data(),payload.size());stream_.flush();
        if(!stream_) failed=true;
    }
};
struct Message {std::string role,content;};
struct Chat {unsigned limit;std::vector<Message> messages;};
inline Chat parse_chat(const std::string& payload) {
    if(payload.size()>maximum_payload) throw std::runtime_error("worker chat exceeds byte budget");
    std::size_t at=0;Chat result{};result.limit=unsigned(take(payload,at,4));
    const auto count=take(payload,at,4);
    if(!result.limit || result.limit>2048 || !count || count>64) throw std::runtime_error("worker chat bounds invalid");
    std::size_t total=0;
    for(std::size_t i=0;i<count;++i) {
        const auto role=take(payload,at,1),length=take(payload,at,4);
        if(role<1 || role>3 || length>65536 || at>payload.size() || length>payload.size()-at || total+length>245760)
            throw std::runtime_error("worker message role/text bounds invalid");
        result.messages.push_back({role==1 ? "system" : role==2 ? "user" : "assistant",payload.substr(at,std::size_t(length))});
        at+=std::size_t(length);total+=std::size_t(length);
    }
    if(at!=payload.size()) throw std::runtime_error("worker chat trailing bytes");
    return result;
}
}
