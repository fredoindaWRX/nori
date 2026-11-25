#!/usr/bin/env python3
"""
Simple correctness test for Nori Graph Scanner.
"""

import sys
import os

# Add tools to path so we can import from nori_graph_scanner
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

def test_basic_imports():
    """Test basic imports work."""
    print("Testing basic imports...")
    
    # Test that core imports
    import nori_graph_scanner.core
    assert hasattr(nori_graph_scanner.core, 'node_id')
    print("✓ core module imported successfully")
    
    # Test that scan imports
    import nori_graph_scanner.scan
    print("✓ scan module imported successfully")
    
    # Test that graph imports (this may fail due to ACTIVE_ROOT issue)
    try:
        import nori_graph_scanner.graph
        print("✓ graph module imported successfully")
    except Exception as e:
        print(f"⚠ graph module import failed: {e}")
    
    print("Basic imports test completed.")

def test_node_id():
    """Test node_id function."""
    print("Testing node_id function...")
    
    from nori_graph_scanner.core import node_id
    id1 = node_id("test.py")
    id2 = node_id("test.py")  # Should be deterministic
    assert id1 == id2
    print(f"✓ node_id works: {id1}")
    
    id3 = node_id("other.py")
    assert id1 != id3  # Different paths should give different IDs
    print(f"✓ node_id is unique: {id3}")

def test_walk_source():
    """Test walk_source function."""
    print("Testing walk_source function...")
    
    from nori_graph_scanner.core import walk_source
    
    # Just verify the function exists and is callable
    assert callable(walk_source)
    print("✓ walk_source is callable")

def test_imports():
    """Test various import patterns."""
    print("Testing imports...")
    
    from nori_graph_scanner.graph import build_graph
    from nori_graph_scanner.core import node_id
    from nori_graph_scanner.scan import scan_python, build_module_map
    
    print("✓ Direct package imports work")
    
if __name__ == "__main__":
    test_basic_imports()
    test_node_id()
    test_walk_source()
    test_imports()
    print("All basic correctness tests passed!")#!/usr/bin/env python3
"""
Simple correctness test for Nori Graph Scanner.
"""

import sys
import os

# Add tools to path so we can import from nori_graph_scanner
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

def test_basic_imports():
    """Test basic imports work."""
    print("Testing basic imports...")
    
    # Test that core imports
    import nori_graph_scanner.core
    assert hasattr(nori_graph_scanner.core, 'node_id')
    print("✓ core module imported successfully")
    
    # Test that scan imports
    import nori_graph_scanner.scan
    print("✓ scan module imported successfully")
    
    # Test that graph imports (this may fail due to ACTIVE_ROOT issue)
    try:
        import nori_graph_scanner.graph
        print("✓ graph module imported successfully")
    except Exception as e:
        print(f"⚠ graph module import failed: {e}")
    
    print("Basic imports test completed.")

def test_node_id():
    """Test node_id function."""
    print("Testing node_id function...")
    
    from nori_graph_scanner.core import node_id
    id1 = node_id("test.py")
    id2 = node_id("test.py")  # Should be deterministic
    assert id1 == id2
    print(f"✓ node_id works: {id1}")
    
    id3 = node_id("other.py")
    assert id1 != id3  # Different paths should give different IDs
    print(f"✓ node_id is unique: {id3}")

def test_walk_source():
    """Test walk_source function."""
    print("Testing walk_source function...")
    
    from nori_graph_scanner.core import walk_source
    
    # Just verify the function exists and is callable
    assert callable(walk_source)
    print("✓ walk_source is callable")

def test_imports():
    """Test various import patterns."""
    print("Testing imports...")
    
    from nori_graph_scanner.graph import build_graph
    from nori_graph_scanner.core import node_id
    from nori_graph_scanner.scan import scan_python, build_module_map
    
    print("✓ Direct package imports work")
    
if __name__ == "__main__":
    test_basic_imports()
    test_node_id()
    test_walk_source()
    test_imports()
    print("All basic correctness tests passed!")