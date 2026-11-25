"""
Nori Quick Start Generator

Generates quick start configuration and setup files for Nori.
Provides guided setup and configuration templates.
"""
import json
import sys
from pathlib import Path
from typing import Dict, Optional
import yaml


class QuickStartGenerator:
    """Generates quick start files for Nori."""
    
    def __init__(self, root: Path = None):
        self.root = root or Path(__file__).resolve().parent.parent
        self.templates_dir = self.root / "nori" / "templates"
        self.templates_dir.mkdir(parents=True, exist_ok=True)
    
    def generate_minimal_config(self) -> Dict:
        """Generate minimal configuration file."""
        config = {
            "owner": {
                "name": "Owner",
                "email": "owner@example.com"
            },
            "knights": {
                "neo": {
                    "port": 9101,
                    "model": "qwen2.5-coder:14b",
                    "role": "Code Smith",
                    "tools": ["coding"],
                    "grants": ["workspace_read", "workspace_write"]
                },
                "trinity": {
                    "port": 9102,
                    "model": "gemma4:12b",
                    "role": "All-Rounder",
                    "tools": ["plugins"],
                    "grants": ["workspace_read"]
                }
            },
            "compute": {
                "ollama_url": "http://127.0.0.1:11434",
                "letta_url": "http://127.0.0.1:8283",
                "localai_url": "http://127.0.0.1:8080",
                "nodes": {
                    "home-rtx4080-super": {
                        "url": "http://127.0.0.1:11434",
                        "capabilities": ["cuda", "cpu", "vision", "reasoning", "coding"],
                        "memory_gb": 24,
                        "priority": 1
                    }
                }
            },
            "services": {
                "ollama_url": "http://127.0.0.1:11434",
                "letta_url": "http://127.0.0.1:8283",
                "localai_url": "http://127.0.0.1:8080"
            },
            "memory": {
                "primary": {
                    "backend": "letta",
                    "url": "http://127.0.0.1:8283"
                },
                "backup": {
                    "backend": "jsonl",
                    "path": "memory/backup.jsonl"
                }
            },
            "sensors": {
                "mic_g10": {
                    "type": "audio",
                    "driver": "sounddevice",
                    "source": "2",
                    "expected_name": "Headset Microphone (G10 MIXER)",
                    "interval": 5,
                    "enabled": False
                }
            }
        }
        
        return config
    
    def generate_setup_script(self, output_path: Optional[Path] = None) -> Path:
        """Generate setup script for quick start."""
        if output_path is None:
            output_path = self.root / "quick_start.bat"
        
        script_content = """@echo off
REM Nori Quick Start Setup Script
echo ========================================
echo Nori Quick Start Setup
echo ========================================
echo.

REM Check Python
python --version
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python 3.10+ from https://python.org
    pause
    exit /b 1
)

echo [1/5] Creating virtual environment...
cd nori
python -m venv .venv-architect
if errorlevel 1 (
    echo ERROR: Failed to create virtual environment
    pause
    exit /b 1
)

echo [2/5] Activating virtual environment...
call .venv-architect\\Scripts\\activate.bat

echo [3/5] Installing dependencies...
pip install --upgrade pip
pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)

echo [4/5] Creating directories...
mkdir ..\\data
mkdir ..\\memory
mkdir ..\\apps
mkdir ..\\backups
mkdir runtime-data\\logs
mkdir runtime-data\\performance
mkdir runtime-data\\cache

echo [5/5] Generating configuration...
python ..\\nori\\tools\\quick_start.py --config

echo.
echo ========================================
echo Setup Complete!
echo ========================================
echo.
echo Next steps:
echo 1. Start Ollama: ollama serve
echo 2. Pull required models: ollama pull qwen2.5-coder:14b
echo 3. Start Nori: python main.py
echo 4. Open Workspace: http://127.0.0.1:9444
echo.
pause
"""
        
        output_path.write_text(script_content, encoding='utf-8')
        return output_path
    
    def generate_powershell_setup(self, output_path: Optional[Path] = None) -> Path:
        """Generate PowerShell setup script."""
        if output_path is None:
            output_path = self.root / "quick_start.ps1"
        
        script_content = """# Nori Quick Start Setup Script (PowerShell)
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Nori Quick Start Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check Python
Write-Host "[1/5] Checking Python..." -ForegroundColor Yellow
$pythonVersion = python --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Python is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Please install Python 3.10+ from https://python.org" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "Python version: $pythonVersion" -ForegroundColor Green

# Create virtual environment
Write-Host "[2/5] Creating virtual environment..." -ForegroundColor Yellow
Set-Location nori
python -m venv .venv-architect
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to create virtual environment" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Activate virtual environment
Write-Host "[3/5] Activating virtual environment..." -ForegroundColor Yellow
& .venv-architect\\Scripts\\Activate.ps1

# Install dependencies
Write-Host "[4/5] Installing dependencies..." -ForegroundColor Yellow
pip install --upgrade pip
pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to install dependencies" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Create directories
Write-Host "[5/5] Creating directories..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path "..\\data" | Out-Null
New-Item -ItemType Directory -Force -Path "..\\memory" | Out-Null
New-Item -ItemType Directory -Force -Path "..\\apps" | Out-Null
New-Item -ItemType Directory -Force -Path "..\\backups" | Out-Null
New-Item -ItemType Directory -Force -Path "runtime-data\\logs" | Out-Null
New-Item -ItemType Directory -Force -Path "runtime-data\\performance" | Out-Null
New-Item -ItemType Directory -Force -Path "runtime-data\\cache" | Out-Null

# Generate configuration
Write-Host "Generating configuration..." -ForegroundColor Yellow
python ..\\nori\\tools\\quick_start.py --config

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Start Ollama: ollama serve" -ForegroundColor White
Write-Host "2. Pull required models: ollama pull qwen2.5-coder:14b" -ForegroundColor White
Write-Host "3. Start Nori: python main.py" -ForegroundColor White
Write-Host "4. Open Workspace: http://127.0.0.1:9444" -ForegroundColor White
Write-Host ""
Read-Host "Press Enter to exit"
"""
        
        output_path.write_text(script_content, encoding='utf-8')
        return output_path
    
    def generate_readme(self, output_path: Optional[Path] = None) -> Path:
        """Generate quick start README."""
        if output_path is None:
            output_path = self.root / "QUICKSTART.md"
        
        readme_content = """# Nori Quick Start Guide

## Prerequisites

- Windows 10/11
- Python 3.10+
- NVIDIA GPU (recommended, 16GB+ VRAM)
- 32GB+ RAM (recommended)

## Quick Setup

### Option 1: Automated Setup (Windows)

Run the quick start script:

```powershell
# PowerShell
quick_start.ps1

# CMD
quick_start.bat
```

### Option 2: Manual Setup

1. **Create virtual environment**
   ```bash
   cd nori
   python -m venv .venv-architect
   .venv-architect\\Scripts\\activate
   ```

2. **Install dependencies**
   ```bash
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

3. **Create directories**
   ```bash
   mkdir data
   mkdir memory
   mkdir apps
   mkdir backups
   mkdir nori\\runtime-data\\logs
   mkdir nori\\runtime-data\\performance
   mkdir nori\\runtime-data\\cache
   ```

4. **Generate configuration**
   ```bash
   python nori\\tools\\quick_start.py --config
   ```

## Starting Nori

### 1. Start Ollama

```bash
ollama serve
```

### 2. Pull Required Models

```bash
ollama pull qwen2.5-coder:14b
ollama pull gemma4:12b
ollama pull qwen3:8b
```

### 3. Start Nori

```bash
cd nori
python main.py
```

### 4. Access Workspace

Open http://127.0.0.1:9444 in your browser

## Voice Interaction

To enable voice interaction, you need to:

1. Configure your microphone in Windows Sound settings
2. Train the Windows Speech Recognition voice profile
3. Say "Hey Nori" followed by your command

## Troubleshooting

### Python not found
- Install Python 3.10+ from https://python.org
- Make sure to add Python to PATH during installation

### Virtual environment creation fails
- Make sure you have write permissions in the directory
- Try running as administrator

### Dependencies installation fails
- Check your internet connection
- Try upgrading pip first: `pip install --upgrade pip`

### Ollama not responding
- Make sure Ollama is running: `ollama serve`
- Check if port 11434 is available
- Try restarting Ollama

### Port conflicts
- Check if ports 9107 (Council) or 9444 (Workspace) are in use
- Close conflicting applications or change ports in config.yaml

## Next Steps

- Read the full documentation: `nori/DOCUMENTATION_INDEX.md`
- Customize your configuration: `nori/config.yaml`
- Set up Home Assistant integration: `nori/HOME_ASSISTANT.md`
- Configure smart home devices

## Support

For more help:
- Check documentation in `nori/Documentation/`
- Review troubleshooting guides
- Check TEAM_UPDATES.txt for current status
"""
        
        output_path.write_text(readme_content, encoding='utf-8')
        return output_path
    
    def generate_all(self) -> Dict:
        """Generate all quick start files."""
        results = {
            "config": self.generate_minimal_config(),
            "setup_script": str(self.generate_setup_script()),
            "powershell_script": str(self.generate_powershell_setup()),
            "readme": str(self.generate_readme())
        }
        
        return results


def main():
    """Command-line interface for quick start generator."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Nori Quick Start Generator")
    parser.add_argument("--config", action="store_true", help="Generate config file")
    parser.add_argument("--script", action="store_true", help="Generate setup script")
    parser.add_argument("--powershell", action="store_true", help="Generate PowerShell script")
    parser.add_argument("--readme", action="store_true", help="Generate README")
    parser.add_argument("--all", action="store_true", help="Generate all files")
    
    args = parser.parse_args()
    
    generator = QuickStartGenerator()
    
    if args.config:
        config = generator.generate_minimal_config()
        config_path = generator.root / "nori" / "config.yaml"
        with open(config_path, 'w', encoding='utf-8') as f:
            yaml.dump(config, f, default_flow_style=False)
        print(f"Generated configuration: {config_path}")
    
    if args.script:
        script_path = generator.generate_setup_script()
        print(f"Generated setup script: {script_path}")
    
    if args.powershell:
        script_path = generator.generate_powershell_setup()
        print(f"Generated PowerShell script: {script_path}")
    
    if args.readme:
        readme_path = generator.generate_readme()
        print(f"Generated README: {readme_path}")
    
    if args.all:
        results = generator.generate_all()
        print("Generated all quick start files:")
        for name, path in results.items():
            print(f"  {name}: {path}")
    
    if not any([args.config, args.script, args.powershell, args.readme, args.all]):
        parser.print_help()


if __name__ == "__main__":
    main()
