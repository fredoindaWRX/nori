#pragma once
#include <cstddef>
#include <string>
#include <vector>

namespace norama {
// Independently implemented incremental JSON-object syntax guard. Copyable so
// a decoder can try an entire token before committing it. NOT schema validation,
// argument preservation, an action authorizer, or a claim of task competence.
class JsonObjectPrefix {
    enum class Phase {key_or_end,key_required,colon,value_or_end,value_required,separator};
    struct Container {bool object;Phase phase;};
    enum class Mode {syntax,string,escape,unicode,low_slash,low_u,literal,number};
    enum class Number {minus,zero,integer,dot,fraction,exponent,exponent_sign,exponent_digits};
    std::vector<Container> stack_;
    Mode mode_=Mode::syntax;
    Number number_=Number::integer;
    std::string literal_;
    std::size_t literal_at_=0,bytes_=0;
    unsigned unicode_=0,unicode_digits_=0,utf8_left_=0;
    unsigned utf8_low_=0x80,utf8_high_=0xbf;
    std::size_t string_characters_=0;
    bool invalid_=false,started_=false,complete_=false,key_=false,low_surrogate_=false;
    static bool space(unsigned char c) {return c==' ' || c=='\t' || c=='\r' || c=='\n';}
    static bool digit(unsigned char c) {return c>='0' && c<='9';}
    bool reject() {invalid_=true;return false;}
    void value_done() {
        if(stack_.empty()) complete_=true;
        else stack_.back().phase=Phase::separator;
    }
    bool open(bool object) {
        if(stack_.size()>=32) return reject();
        stack_.push_back({object,object ? Phase::key_or_end : Phase::value_or_end});
        return true;
    }
    bool close() {stack_.pop_back();value_done();return true;}
    bool start_value(unsigned char c) {
        if(c=='{') return open(true);
        if(c=='[') return open(false);
        if(c=='"') {mode_=Mode::string;key_=false;string_characters_=0;return true;}
        if(c=='t' || c=='f' || c=='n') {
            mode_=Mode::literal;literal_=c=='t' ? "true" : c=='f' ? "false" : "null";
            literal_at_=1;return true;
        }
        if(c=='-' || digit(c)) {
            mode_=Mode::number;
            number_=c=='-' ? Number::minus : c=='0' ? Number::zero : Number::integer;
            return true;
        }
        return reject();
    }
    bool syntax(unsigned char c) {
        if(space(c)) return true;
        if(complete_) return reject();
        if(!started_) {
            if(c!='{') return reject();
            started_=true;return open(true);
        }
        if(stack_.empty()) return reject();
        auto& container=stack_.back();
        switch(container.phase) {
            case Phase::key_or_end:
                if(c=='}') return close();
                [[fallthrough]];
            case Phase::key_required:
                if(c!='"') return reject();
                mode_=Mode::string;key_=true;string_characters_=0;return true;
            case Phase::colon:
                if(c!=':') return reject();
                container.phase=Phase::value_required;return true;
            case Phase::value_or_end:
                if(c==']') return close();
                [[fallthrough]];
            case Phase::value_required:return start_value(c);
            case Phase::separator:
                if(c==',') {
                    container.phase=container.object ? Phase::key_required : Phase::value_required;
                    return true;
                }
                if(c==(container.object ? '}' : ']')) return close();
                return reject();
        }
        return reject();
    }
    bool string_byte(unsigned char c) {
        if(utf8_left_) {
            if(c<utf8_low_ || c>utf8_high_) return reject();
            --utf8_left_;if(!utf8_left_) ++string_characters_;utf8_low_=0x80;utf8_high_=0xbf;return true;
        }
        if(c=='"') {
            mode_=Mode::syntax;
            if(key_) stack_.back().phase=Phase::colon;
            else value_done();
            return true;
        }
        if(c=='\\') {mode_=Mode::escape;return true;}
        if(c<0x20) return reject();
        if(c<0x80) {++string_characters_;return true;}
        if(c>=0xc2 && c<=0xdf) utf8_left_=1;
        else if(c>=0xe0 && c<=0xef) {
            utf8_left_=2;
            if(c==0xe0) utf8_low_=0xa0;
            if(c==0xed) utf8_high_=0x9f;
        } else if(c>=0xf0 && c<=0xf4) {
            utf8_left_=3;
            if(c==0xf0) utf8_low_=0x90;
            if(c==0xf4) utf8_high_=0x8f;
        } else return reject();
        return true;
    }
    bool unicode_byte(unsigned char c) {
        unsigned value;
        if(c>='0' && c<='9') value=c-'0';
        else if(c>='a' && c<='f') value=c-'a'+10;
        else if(c>='A' && c<='F') value=c-'A'+10;
        else return reject();
        unicode_=unicode_*16+value;
        if(++unicode_digits_!=4) return true;
        if(low_surrogate_) {
            if(unicode_<0xdc00 || unicode_>0xdfff) return reject();
            low_surrogate_=false;mode_=Mode::string;++string_characters_;
        } else if(unicode_>=0xd800 && unicode_<=0xdbff) {
            low_surrogate_=true;mode_=Mode::low_slash;
        } else {
            if(unicode_>=0xdc00 && unicode_<=0xdfff) return reject();
            mode_=Mode::string;++string_characters_;
        }
        return true;
    }
    bool number_byte(unsigned char c) {
        // Terminators are reprocessed by syntax; no character is discarded.
        const auto end=[&] {mode_=Mode::syntax;value_done();return syntax(c);};
        switch(number_) {
            case Number::minus:
                if(!digit(c)) return reject();
                number_=c=='0' ? Number::zero : Number::integer;return true;
            case Number::zero:
                if(digit(c)) return reject();
                [[fallthrough]];
            case Number::integer:
                if(digit(c)) return true;
                if(c=='.') {number_=Number::dot;return true;}
                if(c=='e' || c=='E') {number_=Number::exponent;return true;}
                return end();
            case Number::dot:
                if(!digit(c)) return reject();
                number_=Number::fraction;return true;
            case Number::fraction:
                if(digit(c)) return true;
                if(c=='e' || c=='E') {number_=Number::exponent;return true;}
                return end();
            case Number::exponent:
                if(c=='+' || c=='-') {number_=Number::exponent_sign;return true;}
                [[fallthrough]];
            case Number::exponent_sign:
                if(!digit(c)) return reject();
                number_=Number::exponent_digits;return true;
            case Number::exponent_digits:
                if(digit(c)) return true;
                return end();
        }
        return reject();
    }
    bool byte(unsigned char c) {
        if(invalid_ || ++bytes_>262144) return reject();
        switch(mode_) {
            case Mode::syntax:return syntax(c);
            case Mode::string:return string_byte(c);
            case Mode::escape:
                if(c=='u') {mode_=Mode::unicode;unicode_=unicode_digits_=0;return true;}
                if(std::string("\"\\/bfnrt").find(char(c))==std::string::npos) return reject();
                mode_=Mode::string;++string_characters_;return true;
            case Mode::unicode:return unicode_byte(c);
            case Mode::low_slash:
                if(c!='\\') return reject();
                mode_=Mode::low_u;return true;
            case Mode::low_u:
                if(c!='u') return reject();
                mode_=Mode::unicode;unicode_=unicode_digits_=0;return true;
            case Mode::literal:
                if(c!=static_cast<unsigned char>(literal_[literal_at_++])) return reject();
                if(literal_at_==literal_.size()) {mode_=Mode::syntax;value_done();}
                return true;
            case Mode::number:return number_byte(c);
        }
        return reject();
    }
public:
    bool append(const std::string& bytes) {
        for(unsigned char c:bytes) if(!byte(c)) return false;
        return !invalid_;
    }
    bool complete() const {return !invalid_ && complete_;}
    bool valid() const {return !invalid_;}
    std::size_t byte_count() const {return bytes_;}
    bool in_string() const {return mode_==Mode::string || mode_==Mode::escape || mode_==Mode::unicode || mode_==Mode::low_slash || mode_==Mode::low_u;}
    bool closing_string(unsigned char c) const {return mode_==Mode::string && !utf8_left_ && c=='"';}
    std::size_t string_characters() const {return string_characters_;}
};
}
