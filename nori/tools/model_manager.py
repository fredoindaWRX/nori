"""
Nori Model Management Utility

Provides model management for Ollama integration.
Supports listing, pulling, removing, and managing Ollama models.
"""
import json
import sys
import subprocess
from pathlib import Path
from typing import Dict, List, Optional
import requests


class ModelManager:
    """Manages Ollama models for Nori."""
    
    def __init__(self, ollama_url: str = "http://127.0.0.1:11434"):
        self.ollama_url = ollama_url.rstrip('/')
    
    def _check_ollama(self) -> bool:
        """Check if Ollama is running."""
        try:
            response = requests.get(f"{self.ollama_url}/api/tags", timeout=5)
            return response.status_code == 200
        except:
            return False
    
    def list_models(self) -> Dict:
        """List all available Ollama models."""
        if not self._check_ollama():
            return {
                "success": False,
                "error": "Ollama is not running"
            }
        
        try:
            response = requests.get(f"{self.ollama_url}/api/tags", timeout=10)
            if response.status_code == 200:
                data = response.json()
                models = data.get("models", [])
                return {
                    "success": True,
                    "models": [
                        {
                            "name": model.get("name"),
                            "size": model.get("size", 0),
                            "modified": model.get("modified_at")
                        }
                        for model in models
                    ]
                }
            else:
                return {
                    "success": False,
                    "error": f"Ollama API error: {response.status_code}"
                }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    def pull_model(self, model_name: str) -> Dict:
        """Pull a model from Ollama."""
        if not self._check_ollama():
            return {
                "success": False,
                "error": "Ollama is not running"
            }
        
        try:
            response = requests.post(
                f"{self.ollama_url}/api/pull",
                json={"name": model_name},
                timeout=300  # 5 minute timeout for large models
            )
            
            if response.status_code == 200:
                return {
                    "success": True,
                    "model": model_name,
                    "message": f"Model {model_name} pulled successfully"
                }
            else:
                return {
                    "success": False,
                    "error": f"Failed to pull model: {response.status_code}"
                }
        except requests.exceptions.Timeout:
            return {
                "success": False,
                "error": "Pull operation timed out (model may be large)"
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    def remove_model(self, model_name: str) -> Dict:
        """Remove a model from Ollama."""
        if not self._check_ollama():
            return {
                "success": False,
                "error": "Ollama is not running"
            }
        
        try:
            response = requests.delete(
                f"{self.ollama_url}/api/delete",
                json={"name": model_name},
                timeout=30
            )
            
            if response.status_code == 200:
                return {
                    "success": True,
                    "model": model_name,
                    "message": f"Model {model_name} removed successfully"
                }
            else:
                return {
                    "success": False,
                    "error": f"Failed to remove model: {response.status_code}"
                }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    def get_model_info(self, model_name: str) -> Dict:
        """Get information about a specific model."""
        if not self._check_ollama():
            return {
                "success": False,
                "error": "Ollama is not running"
            }
        
        try:
            # Check if model exists
            models_result = self.list_models()
            if not models_result["success"]:
                return models_result
            
            model_exists = any(
                m["name"] == model_name or m["name"].startswith(model_name + ":")
                for m in models_result["models"]
            )
            
            if not model_exists:
                return {
                    "success": False,
                    "error": f"Model {model_name} not found"
                }
            
            # Get model details
            response = requests.post(
                f"{self.ollama_url}/api/show",
                json={"name": model_name},
                timeout=30
            )
            
            if response.status_code == 200:
                data = response.json()
                return {
                    "success": True,
                    "model": model_name,
                    "details": data
                }
            else:
                return {
                    "success": False,
                    "error": f"Failed to get model info: {response.status_code}"
                }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    def check_model_requirements(self, required_models: List[str]) -> Dict:
        """Check if required models are available."""
        models_result = self.list_models()
        
        if not models_result["success"]:
            return {
                "success": False,
                "error": models_result["error"]
            }
        
        available_models = [
            m["name"].split(":")[0]  # Get base name without tag
            for m in models_result["models"]
        ]
        
        missing = []
        available = []
        
        for required in required_models:
            required_base = required.split(":")[0]
            if required_base in available_models:
                available.append(required)
            else:
                missing.append(required)
        
        return {
            "success": True,
            "required": required_models,
            "available": available,
            "missing": missing,
            "all_available": len(missing) == 0
        }
    
    def pull_required_models(self, required_models: List[str]) -> Dict:
        """Pull all required models."""
        if not self._check_ollama():
            return {
                "success": False,
                "error": "Ollama is not running"
            }
        
        results = {
            "success": True,
            "pulled": [],
            "failed": [],
            "already_available": []
        }
        
        for model in required_models:
            # Check if already available
            check_result = self.check_model_requirements([model])
            if check_result["all_available"]:
                results["already_available"].append(model)
                continue
            
            # Pull the model
            pull_result = self.pull_model(model)
            if pull_result["success"]:
                results["pulled"].append(model)
            else:
                results["failed"].append({
                    "model": model,
                    "error": pull_result["error"]
                })
                results["success"] = False
        
        return results


def format_size(size_bytes: int) -> str:
    """Format size in human-readable format."""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024.0:
            return f"{size_bytes:.2f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.2f} TB"


def print_model_list(models: List[Dict]):
    """Print formatted model list."""
    if not models:
        print("No models available")
        return
    
    print(f"Found {len(models)} models:")
    for model in models:
        print(f"  {model['name']}")
        print(f"    Size: {format_size(model['size'])}")
        print(f"    Modified: {model['modified']}")


def main():
    """Command-line interface for model management."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Nori Model Management")
    parser.add_argument("--url", default="http://127.0.0.1:11434", help="Ollama URL")
    subparsers = parser.add_subparsers(dest="command", help="Available commands")
    
    # List command
    subparsers.add_parser("list", help="List available models")
    
    # Pull command
    pull_parser = subparsers.add_parser("pull", help="Pull a model")
    pull_parser.add_argument("model", help="Model name")
    
    # Remove command
    remove_parser = subparsers.add_parser("remove", help="Remove a model")
    remove_parser.add_argument("model", help="Model name")
    
    # Info command
    info_parser = subparsers.add_parser("info", help="Get model information")
    info_parser.add_argument("model", help="Model name")
    
    # Check command
    check_parser = subparsers.add_parser("check", help="Check required models")
    check_parser.add_argument("models", nargs="+", help="Required models")
    
    # Pull required command
    pull_required_parser = subparsers.add_parser("pull-required", help="Pull required models")
    pull_required_parser.add_argument("models", nargs="+", help="Required models")
    
    args = parser.parse_args()
    
    manager = ModelManager(args.url)
    
    if args.command == "list":
        result = manager.list_models()
        if result["success"]:
            print_model_list(result["models"])
        else:
            print(f"Error: {result['error']}")
    
    elif args.command == "pull":
        result = manager.pull_model(args.model)
        if result["success"]:
            print(f"Successfully pulled {args.model}")
        else:
            print(f"Failed to pull {args.model}: {result['error']}")
    
    elif args.command == "remove":
        result = manager.remove_model(args.model)
        if result["success"]:
            print(f"Successfully removed {args.model}")
        else:
            print(f"Failed to remove {args.model}: {result['error']}")
    
    elif args.command == "info":
        result = manager.get_model_info(args.model)
        if result["success"]:
            print(f"Model: {result['model']}")
            print(f"Details: {json.dumps(result['details'], indent=2)}")
        else:
            print(f"Error: {result['error']}")
    
    elif args.command == "check":
        result = manager.check_model_requirements(args.models)
        print(f"Required models: {result['required']}")
        print(f"Available: {result['available']}")
        print(f"Missing: {result['missing']}")
        print(f"All available: {result['all_available']}")
    
    elif args.command == "pull-required":
        result = manager.pull_required_models(args.models)
        print(f"Pulled: {result['pulled']}")
        print(f"Already available: {result['already_available']}")
        print(f"Failed: {result['failed']}")
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
