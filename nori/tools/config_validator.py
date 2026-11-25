"""
Nori Configuration Validation Script

Validates Nori configuration files for correctness and completeness.
Checks required sections, data types, and configuration consistency.
"""
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import yaml


class ConfigValidator:
    """Validates Nori configuration files."""
    
    def __init__(self, config_path: Optional[Path] = None):
        self.config_path = config_path or Path(__file__).resolve().parent.parent / "nori" / "config.yaml"
        self.errors = []
        self.warnings = []
    
    def validate(self) -> Dict:
        """Run full configuration validation."""
        result = {
            "valid": True,
            "errors": [],
            "warnings": []
        }
        
        # Check file exists
        if not self.config_path.exists():
            result["valid"] = False
            result["errors"].append(f"Configuration file not found: {self.config_path}")
            return result
        
        # Load configuration
        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                config = yaml.safe_load(f)
        except yaml.YAMLError as e:
            result["valid"] = False
            result["errors"].append(f"YAML parsing error: {e}")
            return result
        except Exception as e:
            result["valid"] = False
            result["errors"].append(f"Error reading file: {e}")
            return result
        
        # Validate structure
        self._validate_structure(config)
        
        # Validate sections
        self._validate_knights(config.get("knights", {}))
        self._validate_compute(config.get("compute", {}))
        self._validate_sensors(config.get("sensors", {}))
        self._validate_services(config.get("services", {}))
        self._validate_memory(config.get("memory", {}))
        
        result["errors"] = self.errors
        result["warnings"] = self.warnings
        result["valid"] = len(self.errors) == 0
        
        return result
    
    def _validate_structure(self, config: Dict):
        """Validate basic configuration structure."""
        required_sections = ["knights", "compute", "services"]
        
        for section in required_sections:
            if section not in config:
                self.errors.append(f"Missing required section: {section}")
            elif not isinstance(config[section], dict):
                self.errors.append(f"Section {section} must be a dictionary")
    
    def _validate_knights(self, knights: Dict):
        """Validate knights configuration."""
        if not knights:
            self.warnings.append("No knights configured")
            return
        
        for knight_name, knight_config in knights.items():
            if not isinstance(knight_config, dict):
                self.errors.append(f"Knight {knight_name} must be a dictionary")
                continue
            
            # Check required fields
            required_fields = ["port", "model", "role"]
            for field in required_fields:
                if field not in knight_config:
                    self.errors.append(f"Knight {knight_name} missing required field: {field}")
            
            # Validate port
            if "port" in knight_config:
                port = knight_config["port"]
                if not isinstance(port, int) or not (1024 <= port <= 65535):
                    self.errors.append(f"Knight {knight_name} has invalid port: {port}")
            
            # Validate model
            if "model" in knight_config:
                model = knight_config["model"]
                if not isinstance(model, str) or not model:
                    self.errors.append(f"Knight {knight_name} has invalid model: {model}")
    
    def _validate_compute(self, compute: Dict):
        """Validate compute configuration."""
        if not compute:
            self.warnings.append("No compute configuration")
            return
        
        # Check ollama_url
        if "ollama_url" in compute:
            url = compute["ollama_url"]
            if not isinstance(url, str) or not url.startswith("http"):
                self.errors.append(f"Invalid ollama_url: {url}")
        
        # Check nodes
        if "nodes" in compute:
            if not isinstance(compute["nodes"], dict):
                self.errors.append("Nodes must be a dictionary")
            else:
                for node_name, node_config in compute["nodes"].items():
                    if not isinstance(node_config, dict):
                        self.errors.append(f"Node {node_name} must be a dictionary")
                        continue
                    
                    if "url" in node_config:
                        url = node_config["url"]
                        if not isinstance(url, str) or not url.startswith("http"):
                            self.errors.append(f"Node {node_name} has invalid url: {url}")
    
    def _validate_sensors(self, sensors: Dict):
        """Validate sensors configuration."""
        if not sensors:
            return  # Sensors are optional
        
        if not isinstance(sensors, dict):
            self.errors.append("Sensors must be a dictionary")
            return
        
        for sensor_id, sensor_config in sensors.items():
            if not isinstance(sensor_config, dict):
                self.errors.append(f"Sensor {sensor_id} must be a dictionary")
                continue
            
            # Check required fields
            if "type" not in sensor_config:
                self.errors.append(f"Sensor {sensor_id} missing type field")
            if "enabled" not in sensor_config:
                self.warnings.append(f"Sensor {sensor_id} missing enabled field")
    
    def _validate_services(self, services: Dict):
        """Validate services configuration."""
        if not services:
            self.errors.append("No services configured")
            return
        
        # Check required service URLs
        required_services = ["ollama_url"]
        for service in required_services:
            if service not in services:
                self.errors.append(f"Missing required service: {service}")
            elif not isinstance(services[service], str) or not services[service].startswith("http"):
                self.errors.append(f"Invalid {service}: {services[service]}")
    
    def _validate_memory(self, memory: Dict):
        """Validate memory configuration."""
        if not memory:
            self.warnings.append("No memory configuration")
            return
        
        # Check primary backend
        if "primary" in memory:
            primary = memory["primary"]
            if not isinstance(primary, dict):
                self.errors.append("Primary memory must be a dictionary")
            elif "backend" not in primary:
                self.errors.append("Primary memory missing backend field")


def print_validation_report(result: Dict):
    """Print formatted validation report."""
    print("=" * 60)
    print("NORI CONFIGURATION VALIDATION REPORT")
    print("=" * 60)
    
    if result["valid"]:
        print("✓ Configuration is VALID")
    else:
        print("✗ Configuration is INVALID")
    
    print(f"\nErrors: {len(result['errors'])}")
    for error in result["errors"]:
        print(f"  ✗ {error}")
    
    print(f"\nWarnings: {len(result['warnings'])}")
    for warning in result["warnings"]:
        print(f"  ⚠ {warning}")
    
    print("=" * 60)


def main():
    """Command-line interface for configuration validation."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Nori Configuration Validation")
    parser.add_argument("--config", help="Configuration file path")
    parser.add_argument("--json", action="store_true", help="Output JSON format")
    
    args = parser.parse_args()
    
    config_path = Path(args.config) if args.config else None
    validator = ConfigValidator(config_path)
    result = validator.validate()
    
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print_validation_report(result)
    
    sys.exit(0 if result["valid"] else 1)


if __name__ == "__main__":
    main()
