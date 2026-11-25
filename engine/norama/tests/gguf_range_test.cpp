#include "../src/gguf_model.hpp"
#include <iostream>
#include <type_traits>

static_assert(!std::is_move_constructible<norama::GgufFile>::value,"reader must own stable file/views");
static_assert(std::is_const<typename std::remove_reference<decltype(std::declval<norama::GgufFile>().tensors)>::type>::value,
              "validated tensor descriptors must be read-only to callers");

template<class Action> static void rejects(Action action) {
    try { action(); } catch(const std::runtime_error&) { return; }
    throw std::runtime_error("invalid tensor read accepted");
}
int main(int argc,char** argv) {
    try {
        if(argc!=2) throw std::runtime_error("requires owned F32 test fixture");
        norama::GgufFile model(argv[1]);
        if(model.read_f32("test.weight")!=std::vector<float>{-1.5f,2.25f})
            throw std::runtime_error("F32 decoding mismatch");
        if(model.read_weights("test.weight")!=std::vector<float>{-1.5f,2.25f} ||
           model.read_weights("test.weight",0,1)!=std::vector<float>{-1.5f,2.25f})
            throw std::runtime_error("decoded row mismatch");
        rejects([&]{model.read_weights("test.weight",1,1);});
        rejects([&]{model.read_weights("test.weight",0,2);});
        rejects([&]{model.read_weights("test.weight",0,std::numeric_limits<std::uint64_t>::max());});
        if(model.read_range("test.weight",4,4).size()!=4 || !model.read_range("test.weight",8,0).empty())
            throw std::runtime_error("bounded tensor range mismatch");
        rejects([&]{model.read_range("test.weight",9,0);});
        rejects([&]{model.read_range("test.weight",0,9);});
        rejects([&]{model.read_range("test.weight",std::numeric_limits<std::uint64_t>::max(),0);});
        rejects([&]{model.read_range("missing",0,1);});
        norama::GgufFile header(argv[1],false);
        rejects([&]{header.read_range("test.weight",0,1);});
        rejects([&]{header.read_weights("test.weight");});
        std::cout << "Independent checkpoint range reads and rejection checks passed\n";
    } catch(const std::exception& error) {std::cerr << error.what() << '\n';return 1;}
}
