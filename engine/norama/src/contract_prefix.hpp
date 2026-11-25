#pragma once
#include "json_prefix.hpp"
#include "worker_protocol.hpp"
#include <memory>
#include <algorithm>

namespace norama {
// Own bounded NFA byte-grammar interpreter intersected with strict JSON syntax.
// No schema parser or tool authority in this engine. Programs come from the
// local contract compiler; post-validation remains mandatory.
class ContractProgram {
public:
    struct Edge {std::uint32_t target;unsigned symbol;};
    std::vector<std::vector<Edge>> outgoing;
    std::vector<bool> productive;
    std::vector<std::pair<std::uint32_t,std::uint32_t>> string_limits;
    std::uint32_t start=0,end=0;
    explicit ContractProgram(const std::string& bytes) {
        if(bytes.size()>196608 || bytes.size()<24 || bytes.substr(0,4)!="NGM2")
            throw std::runtime_error("invalid native contract grammar header");
        std::size_t at=4;const auto states=wire::take(bytes,at,4),count=wire::take(bytes,at,4);
        start=std::uint32_t(wire::take(bytes,at,4));end=std::uint32_t(wire::take(bytes,at,4));
        const auto limits=wire::take(bytes,at,4);
        if(!states || states>4096 || count>16384 || limits>1024 || start>=states || end>=states || bytes.size()!=24+limits*8+count*10)
            throw std::runtime_error("native contract grammar bounds invalid");
        for(std::size_t i=0;i<limits;++i) {
            const auto minimum=wire::take(bytes,at,4),maximum=wire::take(bytes,at,4);
            if(minimum>maximum || maximum>262144) throw std::runtime_error("invalid native string bounds");
            string_limits.emplace_back(std::uint32_t(minimum),std::uint32_t(maximum));
        }
        outgoing.resize(std::size_t(states));std::vector<std::vector<std::uint32_t>> incoming(std::size_t(states),std::vector<std::uint32_t>{});
        for(std::size_t i=0;i<count;++i) {
            const auto from=wire::take(bytes,at,4),to=wire::take(bytes,at,4),symbol=wire::take(bytes,at,2);
            if(from>=states || to>=states || symbol>=261+limits) throw std::runtime_error("invalid native grammar edge");
            outgoing[std::size_t(from)].push_back({std::uint32_t(to),unsigned(symbol)});
            incoming[std::size_t(to)].push_back(std::uint32_t(from));
        }
        productive.assign(std::size_t(states),false);productive[end]=true;
        std::vector<std::uint32_t> pending{end};
        for(std::size_t i=0;i<pending.size();++i) for(auto from:incoming[pending[i]])
            if(!productive[from]) {productive[from]=true;pending.push_back(from);}
        if(!productive[start]) throw std::runtime_error("native grammar has no accepting path");
    }
    static bool accepts(unsigned symbol,unsigned char byte) {
        if(symbol<256) return symbol==byte;
        if(symbol==257) return byte>=0x20 && byte!='"' && byte!='\\';
        if(symbol==258) return std::string("\"\\/bfnrt").find(char(byte))!=std::string::npos;
        if(symbol==259) return (byte>='0' && byte<='9') || (byte>='a' && byte<='f') || (byte>='A' && byte<='F');
        if(symbol==260) return byte==' ' || byte=='\t' || byte=='\r' || byte=='\n';
        return false; //256 is epsilon,not an input byte.
    }
    std::vector<std::uint32_t> closure(const std::vector<std::uint32_t>& seeds) const {
        std::vector<bool> seen(outgoing.size(),false);std::vector<std::uint32_t> result;
        for(auto seed:seeds) if(productive[seed] && !seen[seed]) {seen[seed]=true;result.push_back(seed);}
        for(std::size_t i=0;i<result.size();++i) for(const auto& edge:outgoing[result[i]])
            if(edge.symbol==256 && productive[edge.target] && !seen[edge.target]) {
                seen[edge.target]=true;result.push_back(edge.target);
            }
        return result;
    }
};

class ContractPrefix {
    std::shared_ptr<const ContractProgram> program_;
    std::vector<std::uint32_t> active_;
    JsonObjectPrefix syntax_;
    bool invalid_=false;
    unsigned whitespace_=0;
public:
    explicit ContractPrefix(std::shared_ptr<const ContractProgram> program):program_(std::move(program)) {
        if(!program_) throw std::invalid_argument("native contract program required");
        active_=program_->closure({program_->start});
    }
    bool append(const std::string& bytes) {
        if(invalid_) return false;
        for(unsigned char byte:bytes) {
            // Bound external whitespace runs independently of string content.
            if(!syntax_.in_string() && ContractProgram::accepts(260,byte)) {
                if(++whitespace_>16) {invalid_=true;return false;}
            } else whitespace_=0;
            std::vector<std::uint32_t> following;
            for(auto current:active_) {
                bool at_maximum=false;
                for(const auto& edge:program_->outgoing[current]) if(edge.symbol>=261)
                    at_maximum=at_maximum || syntax_.string_characters()>=program_->string_limits[edge.symbol-261].second;
                for(const auto& edge:program_->outgoing[current]) {
                    if(edge.symbol>=261) {
                        const auto bounds=program_->string_limits[edge.symbol-261];
                        if(syntax_.closing_string(byte) && syntax_.string_characters()>=bounds.first && syntax_.string_characters()<=bounds.second)
                            following.push_back(edge.target);
                    } else if(ContractProgram::accepts(edge.symbol,byte) &&
                              !(at_maximum && (edge.symbol==257 || edge.symbol=='\\')))
                        following.push_back(edge.target);
                }
            }
            active_=program_->closure(following);
            if(active_.empty() || !syntax_.append(std::string(1,char(byte)))) {invalid_=true;return false;}
        }
        return true;
    }
    bool valid() const {return !invalid_ && syntax_.valid();}
    bool complete() const {return valid() && syntax_.complete() &&
        std::find(active_.begin(),active_.end(),program_->end)!=active_.end();}
};
}
