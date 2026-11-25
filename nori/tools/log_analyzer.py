"""
Nori Log Analyzer Utility

Analyzes Nori log files for errors, warnings, and patterns.
Provides insights into system health and issues.
"""
import json
import re
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from collections import Counter


class LogAnalyzer:
    """Analyzes Nori log files."""
    
    def __init__(self, log_dir: Optional[Path] = None):
        self.log_dir = log_dir or Path(__file__).resolve().parent.parent / "nori" / "runtime-data" / "logs"
        self.analysis = {
            "timestamp": datetime.now().isoformat(),
            "log_files": [],
            "errors": [],
            "warnings": [],
            "patterns": {},
            "summary": {}
        }
    
    def analyze_all(self) -> Dict:
        """Analyze all log files in directory."""
        if not self.log_dir.exists():
            return {
                "success": False,
                "error": f"No log files found in {self.log_dir}"
            }
        
        # Find all log files
        log_files = list(self.log_dir.glob("*.log*"))
        
        if not log_files:
            return {
                "success": False,
                "error": "No log files found"
            }
        
        # Analyze each file
        for log_file in log_files:
            file_analysis = self._analyze_file(log_file)
            self.analysis["log_files"].append(file_analysis)
        
        # Generate summary
        self._generate_summary()
        
        return self.analysis
    
    def _analyze_file(self, log_file: Path) -> Dict:
        """Analyze a single log file."""
        analysis = {
            "file": str(log_file.name),
            "size_bytes": log_file.stat().st_size,
            "line_count": 0,
            "errors": [],
            "warnings": [],
            "error_count": 0,
            "warning_count": 0,
            "levels": Counter(),
            "patterns": {}
        }
        
        try:
            with open(log_file, 'r', encoding='utf-8', errors='ignore') as f:
                lines = f.readlines()
                analysis["line_count"] = len(lines)
                
                for line in lines:
                    # Extract log level
                    level_match = re.search(r'\b(ERROR|WARNING|INFO|DEBUG|CRITICAL)\b', line, re.IGNORECASE)
                    if level_match:
                        level = level_match.group(1).upper()
                        analysis["levels"][level] += 1
                    
                    # Extract errors
                    error_match = re.search(r'\bERROR\b', line, re.IGNORECASE)
                    if error_match:
                        analysis["errors"].append(line.strip())
                        analysis["error_count"] += 1
                        self.analysis["errors"].append({
                            "file": log_file.name,
                            "line": line.strip()
                        })
                    
                    # Extract warnings
                    warning_match = re.search(r'\bWARNING\b', line, re.IGNORECASE)
                    if warning_match:
                        analysis["warnings"].append(line.strip())
                        analysis["warning_count"] += 1
                        self.analysis["warnings"].append({
                            "file": log_file.name,
                            "line": line.strip()
                        })
            
            # Analyze patterns
            analysis["patterns"] = self._analyze_patterns(analysis["errors"] + analysis["warnings"])
            
        except Exception as e:
            analysis["error"] = str(e)
        
        return analysis
    
    def _analyze_patterns(self, lines: List[str]) -> Dict:
        """Analyze common patterns in log lines."""
        patterns = {
            "connection_errors": 0,
            "timeout_errors": 0,
            "permission_errors": 0,
            "file_not_found": 0,
            "import_errors": 0,
            "key_errors": 0
        }
        
        pattern_map = {
            "connection_errors": [r"connection refused", r"network unreachable", r"timeout"],
            "timeout_errors": [r"timeout", r"timed out"],
            "permission_errors": [r"permission denied", r"access denied"],
            "file_not_found": [r"no such file", r"file not found", r"cannot find"],
            "import_errors": [r"import error", r"module not found"],
            "key_errors": [r"key error", r"keyerror"]
        }
        
        for line in lines:
            for pattern_name, pattern_list in pattern_map.items():
                for pattern in pattern_list:
                    if re.search(pattern, line, re.IGNORECASE):
                        patterns[pattern_name] += 1
                        break
        
        return patterns
    
    def _generate_summary(self):
        """Generate analysis summary."""
        total_errors = sum(f["error_count"] for f in self.analysis["log_files"])
        total_warnings = sum(f["warning_count"] for f in self.analysis["log_files"])
        total_lines = sum(f["line_count"] for f in self.analysis["log_files"])
        
        # Aggregate patterns
        all_patterns = Counter()
        for file_analysis in self.analysis["log_files"]:
            for pattern, count in file_analysis["patterns"].items():
                all_patterns[pattern] += count
        
        self.analysis["summary"] = {
            "total_files": len(self.analysis["log_files"]),
            "total_lines": total_lines,
            "total_errors": total_errors,
            "total_warnings": total_warnings,
            "most_common_patterns": dict(all_patterns.most_common(5))
        }
    
    def search_logs(self, pattern: str, file_pattern: str = "*.log") -> List[Dict]:
        """Search logs for a specific pattern."""
        results = []
        
        for log_file in self.log_dir.glob(file_pattern):
            try:
                with open(log_file, 'r', encoding='utf-8', errors='ignore') as f:
                    for line_num, line in enumerate(f, 1):
                        if re.search(pattern, line, re.IGNORECASE):
                            results.append({
                                "file": log_file.name,
                                "line_number": line_num,
                                "line": line.strip()
                            })
            except Exception:
                continue
        
        return results
    
    def get_recent_errors(self, hours: int = 24) -> List[Dict]:
        """Get errors from recent log files."""
        cutoff = datetime.now().timestamp() - (hours * 3600)
        recent_errors = []
        
        for log_file in self.log_dir.glob("*.log*"):
            if log_file.stat().st_mtime < cutoff:
                continue
            
            try:
                with open(log_file, 'r', encoding='utf-8', errors='ignore') as f:
                    for line in f:
                        if re.search(r'\bERROR\b', line, re.IGNORECASE):
                            recent_errors.append({
                                "file": log_file.name,
                                "line": line.strip()
                            })
            except Exception:
                continue
        
        return recent_errors
    
    def analyze_trends(self, hours: int = 24) -> Dict:
        """Analyze error trends over time."""
        cutoff = datetime.now().timestamp() - (hours * 3600)
        error_timeline = {}
        
        for log_file in self.log_dir.glob("*.log*"):
            if log_file.stat().st_mtime < cutoff:
                continue
            
            try:
                with open(log_file, 'r', encoding='utf-8', errors='ignore') as f:
                    for line in f:
                        if re.search(r'\bERROR\b', line, re.IGNORECASE):
                            # Try to extract timestamp
                            timestamp_match = re.search(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}', line)
                            if timestamp_match:
                                timestamp = timestamp_match.group()
                                hour = timestamp.split()[1].split(':')[0]
                                error_timeline[hour] = error_timeline.get(hour, 0) + 1
            except Exception:
                continue
        
        return {
            "time_range_hours": hours,
            "error_timeline": error_timeline,
            "peak_hour": max(error_timeline.items(), key=lambda x: x[1])[0] if error_timeline else None
        }
    
    def save_analysis(self, output_path: Optional[Path] = None) -> Path:
        """Save analysis to file."""
        if output_path is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_path = self.log_dir / f"analysis_{timestamp}.json"
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(self.analysis, f, indent=2)
        
        return output_path
    
    def print_summary(self):
        """Print analysis summary."""
        print("=" * 60)
        print("NORI LOG ANALYSIS SUMMARY")
        print("=" * 60)
        print(f"Timestamp: {self.analysis['timestamp']}")
        
        summary = self.analysis.get("summary", {})
        print(f"\nFiles analyzed: {summary.get('total_files', 0)}")
        print(f"Total lines: {summary.get('total_lines', 0)}")
        print(f"Total errors: {summary.get('total_errors', 0)}")
        print(f"Total warnings: {summary.get('total_warnings', 0)}")
        
        if summary.get("most_common_patterns"):
            print("\nMost common error patterns:")
            for pattern, count in summary["most_common_patterns"].items():
                print(f"  {pattern}: {count}")
        
        print("=" * 60)


def main():
    """Command-line interface for log analysis."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Nori Log Analyzer")
    parser.add_argument("--log-dir", help="Log directory path")
    parser.add_argument("--search", help="Search pattern")
    parser.add_argument("--recent-errors", type=int, help="Show errors from last N hours")
    parser.add_argument("--trends", type=int, help="Analyze trends over N hours")
    parser.add_argument("--print", action="store_true", help="Print summary")
    parser.add_argument("--output", help="Output file path")
    
    args = parser.parse_args()
    
    log_dir = Path(args.log_dir) if args.log_dir else None
    analyzer = LogAnalyzer(log_dir)
    
    if args.search:
        results = analyzer.search_logs(args.search)
        print(f"Found {len(results)} matches:")
        for result in results:
            print(f"  {result['file']}:{result['line_number']}: {result['line'][:100]}")
    
    elif args.recent_errors:
        errors = analyzer.get_recent_errors(args.recent_errors)
        print(f"Found {len(errors)} errors in last {args.recent_errors} hours:")
        for error in errors:
            print(f"  {error['file']}: {error['line'][:100]}")
    
    elif args.trends:
        trends = analyzer.analyze_trends(args.trends)
        print(f"Error trends over last {args.trends} hours:")
        print(f"  Peak hour: {trends['peak_hour']}")
        print(f"  Timeline: {trends['error_timeline']}")
    
    else:
        analysis = analyzer.analyze_all()
        
        if args.print:
            analyzer.print_summary()
        
        output_path = analyzer.save_analysis(Path(args.output) if args.output else None)
        print(f"Analysis saved to: {output_path}")


if __name__ == "__main__":
    main()
