"""
Nori Security Audit Utility

Performs security audits on the Nori system.
Checks for vulnerabilities, permissions, credentials, and security best practices.
"""
import json
import os
import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional
import re


class SecurityAuditor:
    """Performs security audits on Nori system."""
    
    def __init__(self, root: Optional[Path] = None):
        self.root = root or Path(__file__).resolve().parent.parent
        self.audit_report = {
            "timestamp": datetime.now().isoformat(),
            "findings": [],
            "score": 0,
            "max_score": 100
        }
    
    def audit_all(self) -> Dict:
        """Run complete security audit."""
        self.audit_report["findings"] = []
        
        # Run all audit checks
        self._check_file_permissions()
        self._check_credentials_exposure()
        self._check_configuration_security()
        self._check_dependencies()
        self._check_git_secrets()
        self._check_log_files()
        self._check_temp_files()
        
        # Calculate score
        self._calculate_score()
        
        return self.audit_report
    
    def _check_file_permissions(self):
        """Check file permissions for sensitive files."""
        sensitive_files = [
            "nori/config.yaml",
            "integrations/home_assistant.json",
            ".env",
            "*.key",
            "*.pem"
        ]
        
        for pattern in sensitive_files:
            for file_path in self.root.rglob(pattern):
                if file_path.is_file():
                    # Check if file is readable by others
                    try:
                        stat = file_path.stat()
                        mode = oct(stat.st_mode)[-3:]
                        
                        # Check if file is world-readable
                        if mode[-1] in ['4', '5', '6', '7']:
                            self.audit_report["findings"].append({
                                "severity": "high",
                                "category": "file_permissions",
                                "issue": f"File {file_path} is world-readable",
                                "recommendation": "Restrict file permissions using chmod"
                            })
                    except Exception:
                        pass
    
    def _check_credentials_exposure(self):
        """Check for exposed credentials in source files."""
        credential_patterns = [
            r'password\s*=\s*["\'][^"\']+["\']',
            r'api_key\s*=\s*["\'][^"\']+["\']',
            r'secret\s*=\s*["\'][^"\']+["\']',
            r'token\s*=\s*["\'][^"\']+["\']',
            r'[A-Za-z0-9]{32,}',  # Possible API keys
        ]
        
        source_extensions = ['.py', '.yaml', '.yml', '.json', '.md']
        
        for ext in source_extensions:
            for file_path in self.root.rglob(f"*{ext}"):
                if file_path.is_file():
                    try:
                        content = file_path.read_text(encoding='utf-8', errors='ignore')
                        
                        for pattern in credential_patterns:
                            matches = re.finditer(pattern, content, re.IGNORECASE)
                            for match in matches:
                                # Skip if in comments or test files
                                if 'test' in str(file_path).lower():
                                    continue
                                
                                self.audit_report["findings"].append({
                                    "severity": "high",
                                    "category": "credentials_exposure",
                                    "issue": f"Possible credential in {file_path}",
                                    "location": f"Line {content[:match.start()].count(chr(10)) + 1}",
                                    "recommendation": "Move credentials to environment variables or secure config"
                                })
                    except Exception:
                        pass
    
    def _check_configuration_security(self):
        """Check configuration security settings."""
        config_file = self.root / "nori" / "config.yaml"
        
        if not config_file.exists():
            self.audit_report["findings"].append({
                "severity": "medium",
                "category": "configuration",
                "issue": "Configuration file not found",
                "recommendation": "Create configuration file"
            })
            return
        
        try:
            import yaml
            with open(config_file, 'r', encoding='utf-8') as f:
                config = yaml.safe_load(f)
            
            # Check for default passwords
            if config:
                for key, value in self._flatten_dict(config).items():
                    if 'password' in key.lower() and value in ['password', '123456', 'admin']:
                        self.audit_report["findings"].append({
                            "severity": "high",
                            "category": "configuration",
                            "issue": f"Default password in config: {key}",
                            "recommendation": "Change default password"
                        })
            
            # Check for insecure URLs
            if config and 'compute' in config:
                for service, url in config['compute'].items():
                    if isinstance(url, str) and url.startswith('http://'):
                        if 'localhost' not in url and '127.0.0.1' not in url:
                            self.audit_report["findings"].append({
                                "severity": "medium",
                                "category": "configuration",
                                "issue": f"Insecure HTTP URL: {service} uses {url}",
                                "recommendation": "Use HTTPS when possible"
                            })
        except Exception:
            pass
    
    def _check_dependencies(self):
        """Check for vulnerable dependencies."""
        try:
            import subprocess
            result = subprocess.run(
                ["pip", "audit"],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode != 0 and "No known vulnerabilities" not in result.stdout:
                self.audit_report["findings"].append({
                    "severity": "high",
                    "category": "dependencies",
                    "issue": "Potential vulnerable dependencies found",
                    "details": result.stdout[:500],
                    "recommendation": "Run 'pip audit' for details and update vulnerable packages"
                })
        except Exception:
            self.audit_report["findings"].append({
                "severity": "low",
                "category": "dependencies",
                "issue": "pip-audit not installed",
                "recommendation": "Install pip-audit for dependency vulnerability checking"
            })
    
    def _check_git_secrets(self):
        """Check for secrets in git history."""
        if not (self.root / ".git").exists():
            return
        
        try:
            import subprocess
            result = subprocess.run(
                ["git", "log", "--all", "--full-history", "-S", "password", "--source"],
                capture_output=True,
                text=True,
                timeout=30,
                cwd=self.root
            )
            
            if result.stdout.strip():
                self.audit_report["findings"].append({
                    "severity": "high",
                    "category": "git_secrets",
                    "issue": "Possible secrets in git history",
                    "recommendation": "Use git-secrets or BFG Repo-Cleaner to remove secrets from history"
                })
        except Exception:
            pass
    
    def _check_log_files(self):
        """Check for sensitive data in log files."""
        log_dir = self.root / "nori" / "runtime-data" / "logs"
        
        if not log_dir.exists():
            return
        
        sensitive_patterns = [
            r'password["\s:=]+[^\s"\']+',
            r'token["\s:=]+[^\s"\']+',
            r'api[_-]?key["\s:=]+[^\s"\']+',
        ]
        
        for log_file in log_dir.glob("*.log*"):
            try:
                content = log_file.read_text(encoding='utf-8', errors='ignore')
                
                for pattern in sensitive_patterns:
                    if re.search(pattern, content, re.IGNORECASE):
                        self.audit_report["findings"].append({
                            "severity": "medium",
                            "category": "log_files",
                            "issue": f"Possible sensitive data in log file: {log_file.name}",
                            "recommendation": "Clean log files and ensure they don't log sensitive data"
                        })
                        break
            except Exception:
                pass
    
    def _check_temp_files(self):
        """Check for sensitive temp files."""
        temp_patterns = ["*.tmp", "*.temp", "*.bak"]
        
        for pattern in temp_patterns:
            for temp_file in self.root.rglob(pattern):
                if temp_file.is_file():
                    self.audit_report["findings"].append({
                        "severity": "low",
                        "category": "temp_files",
                        "issue": f"Temp file found: {temp_file}",
                        "recommendation": "Clean up temporary files"
                    })
    
    def _flatten_dict(self, d: Dict, parent_key: str = "") -> Dict:
        """Flatten nested dictionary."""
        items = {}
        for key, value in d.items():
            new_key = f"{parent_key}.{key}" if parent_key else key
            if isinstance(value, dict):
                items.update(self._flatten_dict(value, new_key))
            else:
                items[new_key] = value
        return items
    
    def _calculate_score(self):
        """Calculate security score based on findings."""
        score = 100
        
        for finding in self.audit_report["findings"]:
            severity = finding.get("severity", "low")
            if severity == "critical":
                score -= 20
            elif severity == "high":
                score -= 10
            elif severity == "medium":
                score -= 5
            elif severity == "low":
                score -= 2
        
        self.audit_report["score"] = max(0, score)
    
    def save_report(self, output_path: Optional[Path] = None) -> Path:
        """Save audit report to file."""
        if output_path is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_path = self.root / "nori" / "runtime-data" / f"security_audit_{timestamp}.json"
        
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(self.audit_report, f, indent=2)
        
        return output_path
    
    def print_report(self):
        """Print formatted audit report."""
        print("=" * 60)
        print("NORI SECURITY AUDIT REPORT")
        print("=" * 60)
        print(f"Timestamp: {self.audit_report['timestamp']}")
        print(f"Security Score: {self.audit_report['score']}/{self.audit_report['max_score']}")
        print(f"Total Findings: {len(self.audit_report['findings'])}")
        
        # Group by severity
        by_severity = {}
        for finding in self.audit_report["findings"]:
            severity = finding["severity"]
            if severity not in by_severity:
                by_severity[severity] = []
            by_severity[severity].append(finding)
        
        for severity in ["critical", "high", "medium", "low"]:
            if severity in by_severity:
                print(f"\n{severity.upper()} ({len(by_severity[severity])}):")
                for finding in by_severity[severity]:
                    print(f"  - {finding['issue']}")
                    print(f"    Category: {finding['category']}")
                    print(f"    Recommendation: {finding['recommendation']}")
        
        print("=" * 60)


def main():
    """Command-line interface for security audit."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Nori Security Audit")
    parser.add_argument("--root", help="Nori root directory")
    parser.add_argument("--output", help="Output file path")
    parser.add_argument("--print", action="store_true", help="Print report")
    
    args = parser.parse_args()
    
    root = Path(args.root) if args.root else None
    auditor = SecurityAuditor(root)
    
    report = auditor.audit_all()
    
    if args.print:
        auditor.print_report()
    
    output_path = auditor.save_report(Path(args.output) if args.output else None)
    print(f"Security audit saved to: {output_path}")


if __name__ == "__main__":
    main()
